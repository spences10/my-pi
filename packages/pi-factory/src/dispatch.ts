import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { resolve_workflow_policy } from './policy.js';
import type {
	ComplexityAssessment,
	RepositoryPolicy,
	ResolvedRoute,
	RouteOverride,
	TaskIntake,
	WorkflowKind,
} from './types.js';

function contract_hash(value: {
	task: string;
	acceptance_criteria: string[];
	constraints: string[];
	requested_outcome: string;
}): string {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex');
}
function assess_complexity(intake: TaskIntake): ComplexityAssessment {
	const evidence: string[] = [];
	const surface = intake.affected_paths?.length ?? 0;
	const quantities = [
		...intake.task.matchAll(
			/\b(\d+)\s+(?:files?|paths?|modules?|packages?|violations?|errors?|occurrences?|records?|rows?)\b/gi,
		),
	].map((match) => Number(match[1]));
	const semantic_risk =
		/\b(migration|refactor|semantic|type(?:s|script)?|architecture|cross[- ]cutting|repository[- ]wide|repo[- ]wide)\b/i.test(
			intake.task,
		);
	let score = Math.min(4, surface);
	if (surface >= 10) {
		score += 3;
		evidence.push(`${surface} affected paths`);
	}
	const largest = Math.max(0, ...quantities);
	if (largest >= 25) {
		score += largest >= 100 ? 5 : 3;
		evidence.push(`task scale signal ${largest}`);
	}
	if (semantic_risk) {
		score += 3;
		evidence.push('semantic or cross-cutting change signal');
	}
	if (
		/\b(public api|database|security|release|production)\b/i.test(
			intake.task,
		)
	) {
		score += 3;
		evidence.push('safety-sensitive surface signal');
	}
	const level =
		score >= 10
			? 'critical'
			: score >= 7
				? 'large'
				: score >= 3
					? 'medium'
					: 'small';
	return {
		level,
		score,
		evidence,
		semantic_risk,
		affected_surface: surface,
	};
}

const patterns: Array<[WorkflowKind, RegExp, string]> = [
	[
		'incident',
		/\b(incident|outage|production hotfix|sev[0-3])\b/i,
		'Incident or production outage signal',
	],
	[
		'safe-release',
		/\b(release|publish|ship version|changeset)\b/i,
		'Release side effect signal',
	],
	[
		'database-migration',
		/\b(database|migration|schema|backfill|sqlite|postgres)\b/i,
		'Database or migration surface',
	],
	[
		'ui-copy',
		/\b(ui|ux|svelte|component|page|copy|accessibility|responsive)\b/i,
		'UI or copy surface',
	],
	[
		'architecture',
		/\b(architecture|research|design decision|compare approaches|rfc)\b/i,
		'Architecture or research intent',
	],
	[
		'ambiguous-bug',
		/\b(bug|broken|fails|flaky|regression|debug|unknown)\b/i,
		'Bug signal requiring diagnosis',
	],
	[
		'chore',
		/\b(chore|dependency|upgrade|renovate|format|lint cleanup|docs only)\b/i,
		'Routine maintenance signal',
	],
	[
		'feature',
		/\b(add|build|implement|feature|support|create)\b/i,
		'Feature delivery signal',
	],
];
export function classify_task(intake: TaskIntake): {
	workflow: WorkflowKind;
	rationale: string[];
	assumptions: string[];
} {
	const hints = intake.hints;
	if (hints?.workflow)
		return {
			workflow: hints.workflow,
			rationale: ['Explicit intake workflow hint'],
			assumptions: [],
		};
	const semantic: Array<[boolean | undefined, WorkflowKind, string]> =
		[
			[hints?.incident, 'incident', 'Explicit incident hint'],
			[hints?.release, 'safe-release', 'Explicit release hint'],
			[
				hints?.database,
				'database-migration',
				'Explicit database hint',
			],
			[hints?.ui, 'ui-copy', 'Explicit UI hint'],
			[
				hints?.architecture,
				'architecture',
				'Explicit architecture hint',
			],
			[hints?.ambiguity, 'ambiguous-bug', 'Explicit ambiguity hint'],
		];
	const signalled = semantic.filter(([on]) => on);
	if (signalled.length > 1)
		throw new Error(
			`Conflicting classification signals: ${signalled.map(([, kind]) => kind).join(', ')}`,
		);
	if (signalled[0])
		return {
			workflow: signalled[0][1],
			rationale: [signalled[0][2]],
			assumptions: [],
		};
	const matches = patterns.filter(([, pattern]) =>
		pattern.test(intake.task),
	);
	if (!matches.length)
		throw new Error(
			'Unsupported or ambiguous task: provide a workflow hint or manual override',
		);
	const selected = matches[0]!;
	return {
		workflow: selected[0],
		rationale: [selected[2]],
		assumptions:
			matches.length > 1
				? [
						`Lower-priority signals also matched: ${matches
							.slice(1)
							.map(([kind]) => kind)
							.join(', ')}`,
					]
				: [],
	};
}
function path_matches(
	path: string,
	pattern: string,
	cwd: string,
): boolean {
	const path_segments = path.split('/').filter(Boolean);
	const pattern_segments = resolve(cwd, pattern)
		.split('/')
		.filter(Boolean);
	const match = (
		path_index: number,
		pattern_index: number,
	): boolean => {
		if (pattern_index === pattern_segments.length)
			return path_index === path_segments.length;
		const segment = pattern_segments[pattern_index]!;
		if (segment === '**')
			return (
				match(path_index, pattern_index + 1) ||
				(path_index < path_segments.length &&
					match(path_index + 1, pattern_index))
			);
		if (path_index >= path_segments.length) return false;
		const expression = new RegExp(
			`^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
		);
		return (
			expression.test(path_segments[path_index]!) &&
			match(path_index + 1, pattern_index + 1)
		);
	};
	return match(0, 0);
}
export function dispatch_task(
	intake: TaskIntake,
	policy: RepositoryPolicy,
	override?: RouteOverride,
	evolution?: {
		version_id: string;
		recommendation_id: string;
		status: 'canary' | 'active';
		projects: string[];
		workflow_kinds: string[];
		patch: Record<string, unknown>;
	},
): ResolvedRoute {
	let classified: ReturnType<typeof classify_task>;
	try {
		classified = classify_task(intake);
	} catch (error) {
		if (!override?.workflow) throw error;
		classified = {
			workflow: override.workflow,
			rationale: ['Explicit human workflow override'],
			assumptions: [
				`Automatic classification was bypassed: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
	const work_type = classified.workflow;
	const complexity = assess_complexity(intake);
	if (complexity.level === 'large' || complexity.level === 'critical')
		classified.rationale.push(
			`Complexity ${complexity.level} requires strengthened routing: ${complexity.evidence.join(', ')}`,
		);
	let workflow_kind = override?.workflow ?? work_type;
	if (
		override?.workflow &&
		override.workflow !== classified.workflow
	) {
		const baseline = resolve_workflow_policy(
			classified.workflow,
			policy,
		);
		const candidate = resolve_workflow_policy(
			override.workflow,
			policy,
		);
		const risk_order = ['low', 'medium', 'high', 'critical'] as const;
		const baseline_has_review =
			baseline.review_mode !== 'deterministic-only';
		const candidate_has_review =
			candidate.review_mode !== 'deterministic-only';
		if (
			risk_order.indexOf(candidate.risk) <
				risk_order.indexOf(baseline.risk) ||
			(baseline_has_review && !candidate_has_review)
		) {
			workflow_kind = classified.workflow;
			classified.assumptions.push(
				`Ignored lowering workflow override ${override.workflow}; retained ${classified.workflow} safety`,
			);
		}
	}
	if (
		(complexity.level === 'large' ||
			complexity.level === 'critical') &&
		['chore', 'ui-copy', 'feature'].includes(workflow_kind)
	) {
		workflow_kind =
			complexity.level === 'critical' ? 'architecture' : 'feature';
		classified.rationale.push(
			`Complexity ${complexity.level} strengthens effective workflow from ${work_type} to ${workflow_kind}: ${complexity.evidence.join(', ')}`,
		);
	}
	const workflow = resolve_workflow_policy(workflow_kind, policy);
	const risk_order = ['low', 'medium', 'high', 'critical'] as const;
	let complexity_risk_strengthened = false;
	const complexity_minimum_risk =
		complexity.level === 'critical'
			? 'critical'
			: complexity.level === 'large'
				? 'high'
				: undefined;
	if (
		complexity_minimum_risk &&
		risk_order.indexOf(workflow.risk) <
			risk_order.indexOf(complexity_minimum_risk)
	) {
		workflow.risk = complexity_minimum_risk;
		complexity_risk_strengthened = true;
	}
	const hinted_risk = intake.hints?.risk;
	let intake_risk_strengthened = false;
	if (hinted_risk) {
		if (
			risk_order.indexOf(hinted_risk) >
			risk_order.indexOf(workflow.risk)
		) {
			workflow.risk = hinted_risk;
			intake_risk_strengthened = true;
			classified.rationale.push(
				`Risk strengthened by intake hint: ${hinted_risk}`,
			);
		} else if (
			risk_order.indexOf(hinted_risk) <
			risk_order.indexOf(workflow.risk)
		) {
			classified.assumptions.push(
				`Ignored risk hint ${hinted_risk}; intake cannot lower workflow risk ${workflow.risk}`,
			);
		}
	}
	if (intake.urgency === 'urgent') {
		if (
			risk_order.indexOf(workflow.risk) < risk_order.indexOf('high')
		) {
			workflow.risk = 'high';
			intake_risk_strengthened = true;
		}
		workflow.stall_timeout_ms = Math.min(
			workflow.stall_timeout_ms,
			300_000,
		);
		classified.rationale.push(
			'Urgent intake raises minimum risk to high and shortens stall escalation to 5 minutes',
		);
	}
	if (override?.parallelism !== undefined)
		workflow.compute.parallelism = Math.min(
			Math.max(1, override.parallelism),
			workflow.compute.parallelism,
			policy.max_parallelism ?? 3,
		);
	for (const role of ['planner', 'executor', 'reviewer'] as const) {
		if (override?.model_overrides?.[role]) {
			workflow.compute[role].model = override.model_overrides[role];
			workflow.compute[role].enforcement = 'enforced';
		} else
			workflow.compute[role].enforcement = workflow.compute[role]
				.model
				? 'enforced'
				: 'advisory';
	}
	const workspace_cwd = resolve(intake.cwd);
	const affected_paths = (
		intake.affected_paths?.length ? intake.affected_paths : ['.']
	).map((path) => resolve(workspace_cwd, path));
	if (
		affected_paths.some(
			(path) =>
				path !== workspace_cwd &&
				!path.startsWith(`${workspace_cwd}/`),
		)
	)
		throw new Error(
			'Affected paths must remain inside the workspace',
		);
	const forbidden = policy.forbidden_paths?.find((pattern) =>
		affected_paths.some((path) =>
			path_matches(path, pattern, workspace_cwd),
		),
	);
	if (forbidden)
		throw new Error(
			`Repository policy forbids affected path: ${forbidden}`,
		);
	const risky =
		policy.risky_paths?.filter((pattern) =>
			affected_paths.some((path) =>
				path_matches(path, pattern, workspace_cwd),
			),
		) ?? [];
	if (risky.length) {
		if (workflow.risk === 'low' || workflow.risk === 'medium')
			workflow.risk = 'high';
		if (!workflow.approvals.includes('public-contract'))
			workflow.approvals.push('public-contract');
		classified.rationale.push(
			`Risk raised by repository paths: ${risky.join(', ')}`,
		);
	}
	if (
		(intake_risk_strengthened || complexity_risk_strengthened) &&
		!workflow.approvals.includes('public-contract')
	)
		workflow.approvals.push('public-contract');
	let applied_evolution = false;
	if (
		evolution &&
		(!evolution.projects.length ||
			evolution.projects.includes(workspace_cwd)) &&
		(!evolution.workflow_kinds.length ||
			evolution.workflow_kinds.includes(workflow.id))
	) {
		for (const [field, value] of Object.entries(evolution.patch)) {
			if (typeof value !== 'number' || !Number.isInteger(value))
				throw new Error(
					`Evolution field ${field} must be an integer`,
				);
			const minimum = field === 'retry_limit' ? 0 : 1;
			if (value < minimum)
				throw new Error(
					`Evolution field ${field} is outside safe bounds`,
				);
			const numeric = value;
			if (field === 'stall_timeout_ms')
				workflow.stall_timeout_ms = Math.min(
					workflow.stall_timeout_ms,
					numeric,
				);
			else if (field === 'max_parallelism')
				workflow.compute.parallelism = Math.min(
					workflow.compute.parallelism,
					numeric,
				);
			else if (field === 'retry_limit')
				for (const node of workflow.nodes)
					node.retry_limit = Math.min(node.retry_limit, numeric);
			else
				throw new Error(
					`Evolution field ${field} is not route-applicable`,
				);
		}
		applied_evolution = true;
	}
	const requested = [...new Set(intake.requested_side_effects ?? [])];
	for (const action of requested)
		if (!workflow.approvals.includes(action))
			workflow.approvals.push(action);
	if (workflow.approvals.length) {
		const complete = workflow.nodes.find(
			(node) => node.kind === 'complete',
		)!;
		let approval = workflow.nodes.find(
			(node) => node.kind === 'approval',
		);
		if (!approval) {
			approval = {
				id: 'approval',
				kind: 'approval',
				depends_on: complete.depends_on,
				owner_role: 'human',
				retry_limit: 0,
				approval_actions: workflow.approvals,
			};
			workflow.nodes.splice(
				workflow.nodes.indexOf(complete),
				0,
				approval,
			);
			complete.depends_on = ['approval'];
		} else approval.approval_actions = workflow.approvals;
	}
	const requested_outcome = intake.requested_outcome ?? intake.task;
	const contract_value = {
		task: intake.task,
		acceptance_criteria: [
			...(intake.acceptance_criteria?.length
				? intake.acceptance_criteria
				: [requested_outcome]),
		],
		constraints: [...(intake.constraints ?? [])],
		requested_outcome,
	};
	const route: ResolvedRoute = {
		schema_version: 1,
		route_id: randomUUID(),
		created_at: new Date().toISOString(),
		workspace: {
			cwd: workspace_cwd,
			id: createHash('sha256')
				.update(workspace_cwd)
				.digest('hex')
				.slice(0, 16),
		},
		work_type,
		workflow,
		contract: {
			version: 1,
			...contract_value,
			hash: contract_hash(contract_value),
			status: 'authoritative',
		},
		complexity,
		policy_id: policy.policy_id,
		rationale: [
			...classified.rationale,
			...(override ? [`Human override: ${override.reason}`] : []),
			...(applied_evolution
				? [
						`Active factory evolution ${evolution!.version_id} from recommendation ${evolution!.recommendation_id}`,
					]
				: []),
		],
		assumptions: classified.assumptions,
		affected_paths,
		requested_side_effects: requested,
		override,
		harness: {
			allowed_paths: affected_paths,
			validation_commands: workflow.validations
				.filter((gate) => gate.required && gate.execution === 'shell')
				.map((gate) => gate.command!),
			tool_validations: workflow.validations.filter(
				(gate) => gate.required && gate.execution === 'tool',
			),
			allow_test_changes: true,
			escalation_rules: [
				'Retry budget exhausted',
				'Contradictory evidence',
				'Scope or risk expands',
				'Unsafe fix proposed',
				'Owner missing or stalled',
				'Approval required or refused',
			],
		},
		coordination: {
			owner_required: true,
			path_claims: affected_paths,
			supervision: 'peer-evidence-only',
		},
		policy_sources: [
			'runtime workflow catalog@1',
			policy.policy_id,
			...(applied_evolution
				? [`factory-evolution:${evolution!.version_id}`]
				: []),
		],
	};
	return route;
}
export function route_fingerprint(route: ResolvedRoute): string {
	const {
		route_id: _route_id,
		created_at: _created_at,
		...stable_route
	} = route;
	return createHash('sha256')
		.update(JSON.stringify(stable_route))
		.digest('hex');
}
