import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
	compare_calibration_cohorts,
	type CalibrationReport,
} from './calibration.js';
import type { ResolvedRoute } from './types.js';

export type RecommendationStatus =
	| 'proposed'
	| 'simulated'
	| 'approved'
	| 'refused'
	| 'canary'
	| 'promoted'
	| 'rolled-back'
	| 'blocked';
export interface FactoryRecommendation {
	schema_version: 1;
	recommendation_id: string;
	algorithm_version: string;
	created_at: string;
	target: {
		scope: 'workflow' | 'project';
		id: string;
		field: string;
	};
	current_value: unknown;
	proposed_value: unknown;
	evidence_report_id: string;
	evidence_fingerprint: string;
	confidence: 'low' | 'medium' | 'high';
	rationale: string;
	expected_impact: string;
	expected_cost: string;
	safety: {
		classification: 'low-risk' | 'material' | 'unsafe';
		invariants: string[];
	};
	rollback: { required: true; prior_version: string };
	status: RecommendationStatus;
	history: Array<{
		status: RecommendationStatus;
		at: string;
		actor: string;
		reason: string;
	}>;
	simulation?: RecommendationSimulation;
	approval?: {
		payload_hash: string;
		actor: string;
		authentication:
			| 'extension-ui-confirmation'
			| 'embedding-application';
		approved_at: string;
	};
	canary?: {
		version_id: string;
		projects: string[];
		workflow_kinds: string[];
		started_at: string;
	};
}
export interface RecommendationSimulation {
	report_fingerprint: string;
	passed: boolean;
	regressions: string[];
	expected_deltas: Record<string, number>;
	simulated_at: string;
}
export interface EvolutionVersion<T = unknown> {
	version_id: string;
	parent_version?: string;
	recommendation_id: string;
	value: T;
	value_hash: string;
	actor: string;
	created_at: string;
	status: 'canary' | 'active' | 'superseded' | 'rolled-back';
	scope: { projects: string[]; workflow_kinds: string[] };
	rollback_to?: string;
}
interface EvolutionFile {
	schema_version: 1;
	revision: number;
	active_version?: string;
	versions: Record<string, EvolutionVersion>;
	recommendations: Record<string, FactoryRecommendation>;
}
const forbidden_fields = [
	'risk',
	'approvals',
	'required_approvals',
	'validations',
	'requested_side_effects',
	'forbidden_paths',
	'risky_paths',
];
const supported_fields = new Set([
	'max_parallelism',
	'stall_timeout_ms',
	'retry_limit',
]);
const automatic_fields = new Set([
	'max_parallelism',
	'stall_timeout_ms',
]);
function sha(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex');
}
function now(): string {
	return new Date().toISOString();
}
function recommendation_payload(
	recommendation: FactoryRecommendation,
): Record<string, unknown> {
	return {
		algorithm_version: recommendation.algorithm_version,
		target: recommendation.target,
		current_value: recommendation.current_value,
		proposed_value: recommendation.proposed_value,
		evidence_report_id: recommendation.evidence_report_id,
		evidence_fingerprint: recommendation.evidence_fingerprint,
		confidence: recommendation.confidence,
		rationale: recommendation.rationale,
		expected_impact: recommendation.expected_impact,
		expected_cost: recommendation.expected_cost,
		safety: recommendation.safety,
		rollback: recommendation.rollback,
	};
}
function assert_safe(recommendation: FactoryRecommendation): void {
	const normalized_field = recommendation.target.field.toLowerCase();
	if (
		forbidden_fields.some((field) => normalized_field.includes(field))
	)
		throw new Error(
			'Recommendation targets an authority or safety boundary',
		);
	if (!supported_fields.has(recommendation.target.field))
		throw new Error(
			`Recommendation field ${recommendation.target.field} is not safely route-applicable`,
		);
	const bounded_numeric = supported_fields.has(
		recommendation.target.field,
	);
	if (bounded_numeric) {
		if (
			typeof recommendation.current_value !== 'number' ||
			typeof recommendation.proposed_value !== 'number' ||
			!Number.isInteger(recommendation.current_value) ||
			!Number.isInteger(recommendation.proposed_value)
		)
			throw new Error(
				'Bounded recommendation values must be integers',
			);
		const minimum =
			recommendation.target.field === 'retry_limit' ? 0 : 1;
		if (
			recommendation.proposed_value < minimum ||
			recommendation.proposed_value > recommendation.current_value
		)
			throw new Error(
				'Recommendation cannot exceed safe numeric bounds',
			);
	}
	if (!recommendation.rollback?.prior_version)
		throw new Error(
			'Recommendation requires an exact rollback version',
		);
}
export function create_recommendation(
	input: Omit<
		FactoryRecommendation,
		| 'schema_version'
		| 'recommendation_id'
		| 'created_at'
		| 'status'
		| 'history'
		| 'approval'
		| 'canary'
		| 'simulation'
	>,
): FactoryRecommendation {
	const recommendation: FactoryRecommendation = {
		...input,
		schema_version: 1,
		recommendation_id: randomUUID(),
		created_at: now(),
		status: 'proposed',
		history: [
			{
				status: 'proposed',
				at: now(),
				actor: `algorithm:${input.algorithm_version}`,
				reason: input.rationale,
			},
		],
	};
	assert_safe(recommendation);
	return recommendation;
}
function cohort_value(
	report: CalibrationReport,
	key: string,
	field: string,
): number | undefined {
	const cohort = report.cohorts.find((item) => item.key === key);
	if (!cohort) return undefined;
	if (field === 'retry_limit') return cohort.pins.retry_limit;
	if (field === 'stall_timeout_ms')
		return cohort.pins.stall_timeout_ms;
	if (field === 'max_parallelism') return cohort.pins.max_parallelism;
	return undefined;
}
function controlled_experiment_matches(
	report: CalibrationReport,
	production_key: string,
	experimental_key: string,
	field: string,
): boolean {
	const production = report.cohorts.find(
		(item) => item.key === production_key,
	);
	const experimental = report.cohorts.find(
		(item) => item.key === experimental_key,
	);
	if (!production || !experimental) return false;
	if (
		production.pins.gate_fingerprint !==
		experimental.pins.gate_fingerprint
	)
		return false;
	if (
		field !== 'max_parallelism' &&
		production.pins.compute_fingerprint !==
			experimental.pins.compute_fingerprint
	)
		return false;
	return [...supported_fields]
		.filter((candidate) => candidate !== field)
		.every(
			(candidate) =>
				cohort_value(report, production_key, candidate) ===
				cohort_value(report, experimental_key, candidate),
		);
}
export function recommend_calibration_change(
	report: CalibrationReport,
	production_key: string,
	experimental_key: string,
	options: { prior_version: string; algorithm_version?: string },
): FactoryRecommendation | undefined {
	const comparison = compare_calibration_cohorts(
		report,
		production_key,
		experimental_key,
	);
	if (!comparison.comparable) return undefined;
	const production = report.cohorts.find(
		(item) => item.key === production_key,
	)!;
	const experimental = report.cohorts.find(
		(item) => item.key === experimental_key,
	)!;
	const changed = [...supported_fields].filter(
		(field) =>
			cohort_value(report, production_key, field) !==
			cohort_value(report, experimental_key, field),
	);
	if (changed.length !== 1) return undefined;
	const field = changed[0]!;
	if (
		!controlled_experiment_matches(
			report,
			production_key,
			experimental_key,
			field,
		)
	)
		return undefined;
	const current_value = cohort_value(report, production_key, field)!;
	const proposed_value = cohort_value(
		report,
		experimental_key,
		field,
	)!;
	if (proposed_value > current_value) return undefined;
	const confidence_order = ['insufficient', 'low', 'medium', 'high'];
	const confidence_index = Math.min(
		...experimental.metrics.map((metric) =>
			confidence_order.indexOf(metric.confidence),
		),
	);
	const confidence = confidence_order[
		Math.max(1, confidence_index)
	] as FactoryRecommendation['confidence'];
	return create_recommendation({
		algorithm_version: options.algorithm_version ?? '1',
		target: { scope: 'workflow', id: production.workflow, field },
		current_value,
		proposed_value,
		evidence_report_id: report.report_id,
		evidence_fingerprint: report.fingerprint,
		confidence,
		rationale: `Controlled experiment ${experimental.pins.experiment_id} changed only ${field}; observed deltas: ${JSON.stringify(comparison.deltas)}`,
		expected_impact: `Apply the measured ${field} reduction to ${production.workflow}`,
		expected_cost: `Observed cost delta: ${comparison.deltas.cost_usd ?? 'not available'}`,
		safety: {
			classification:
				field === 'retry_limit' ? 'material' : 'low-risk',
			invariants: [
				'Risk and approval boundaries remain unchanged',
				'Validation gates remain unchanged',
				'Only a bounded numeric reduction is permitted',
			],
		},
		rollback: {
			required: true,
			prior_version: options.prior_version,
		},
	});
}
export function simulate_recommendation(
	recommendation: FactoryRecommendation,
	report: CalibrationReport,
	production_key: string,
	experimental_key: string,
	thresholds: Record<string, number> = {},
): FactoryRecommendation {
	if (
		report.fingerprint !== recommendation.evidence_fingerprint ||
		report.report_id !== recommendation.evidence_report_id
	)
		throw new Error('Recommendation evidence report does not match');
	const comparison = compare_calibration_cohorts(
		report,
		production_key,
		experimental_key,
	);
	if (!comparison.comparable)
		throw new Error('Calibration cohorts are not safe to compare');
	const production = report.cohorts.find(
		(item) => item.key === production_key,
	)!;
	if (
		recommendation.target.scope === 'workflow' &&
		recommendation.target.id !== production.workflow
	)
		throw new Error(
			'Recommendation target does not match the cohort',
		);
	if (
		!controlled_experiment_matches(
			report,
			production_key,
			experimental_key,
			recommendation.target.field,
		)
	)
		throw new Error(
			'Recommendation is not backed by a single controlled change',
		);
	if (
		cohort_value(
			report,
			production_key,
			recommendation.target.field,
		) !== recommendation.current_value ||
		cohort_value(
			report,
			experimental_key,
			recommendation.target.field,
		) !== recommendation.proposed_value
	)
		throw new Error(
			'Recommendation values do not match the controlled experiment',
		);
	const expected_deltas = comparison.deltas;
	const higher_is_better = new Set([
		'success_rate',
		'first_pass_success_rate',
	]);
	const regressions = Object.entries(expected_deltas)
		.filter(([metric, delta]) => {
			const threshold = thresholds[metric] ?? 0;
			return higher_is_better.has(metric)
				? delta < threshold
				: delta > threshold;
		})
		.map(([metric]) => metric);
	recommendation.simulation = {
		report_fingerprint: report.fingerprint,
		passed: regressions.length === 0,
		regressions,
		expected_deltas,
		simulated_at: now(),
	};
	recommendation.status = regressions.length
		? 'blocked'
		: 'simulated';
	recommendation.history.push({
		status: recommendation.status,
		at: now(),
		actor: 'simulator',
		reason: regressions.length
			? `Regressions: ${regressions.join(', ')}`
			: 'Replay passed configured thresholds',
	});
	return recommendation;
}
export function decide_recommendation(
	recommendation: FactoryRecommendation,
	decision: 'approved' | 'refused',
	input: {
		actor: string;
		authentication:
			| 'extension-ui-confirmation'
			| 'embedding-application';
		reason: string;
	},
): FactoryRecommendation {
	if (!input.actor.trim() || !input.reason.trim())
		throw new Error('Authenticated actor and reason are required');
	if (
		decision === 'approved' &&
		recommendation.status !== 'simulated'
	)
		throw new Error('Only a successful simulation can be approved');
	recommendation.status = decision;
	if (decision === 'approved')
		recommendation.approval = {
			payload_hash: sha(recommendation_payload(recommendation)),
			actor: input.actor,
			authentication: input.authentication,
			approved_at: now(),
		};
	recommendation.history.push({
		status: decision,
		at: now(),
		actor: input.actor,
		reason: input.reason,
	});
	return recommendation;
}
export function automatic_adjustment_allowed(
	recommendation: FactoryRecommendation,
	policy: {
		enabled: boolean;
		fields: string[];
		minimum_confidence: 'medium' | 'high';
	},
): boolean {
	if (
		!policy.enabled ||
		recommendation.status !== 'simulated' ||
		recommendation.simulation?.passed !== true ||
		recommendation.safety.classification !== 'low-risk'
	)
		return false;
	if (
		!automatic_fields.has(recommendation.target.field) ||
		!policy.fields.includes(recommendation.target.field)
	)
		return false;
	if (
		policy.minimum_confidence === 'high' &&
		recommendation.confidence !== 'high'
	)
		return false;
	try {
		assert_safe(recommendation);
		return true;
	} catch {
		return false;
	}
}
export class PolicyEvolutionStore {
	readonly path: string;
	constructor(path: string) {
		this.path = resolve(path);
	}
	private load(): EvolutionFile {
		if (!existsSync(this.path))
			return {
				schema_version: 1,
				revision: 0,
				versions: {},
				recommendations: {},
			};
		const file = JSON.parse(
			readFileSync(this.path, 'utf8'),
		) as EvolutionFile;
		if (file.schema_version !== 1)
			throw new Error('Unsupported evolution store');
		return file;
	}
	private save(file: EvolutionFile): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const lock_path = `${this.path}.lock`;
		let lock: number;
		try {
			lock = openSync(lock_path, 'wx', 0o600);
		} catch {
			throw new Error(
				'Evolution store is being updated concurrently',
			);
		}
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try {
			const current_revision = this.load().revision;
			if (current_revision !== file.revision)
				throw new Error('Evolution store changed concurrently');
			file.revision += 1;
			writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
				flag: 'wx',
				mode: 0o600,
			});
			renameSync(temporary, this.path);
		} finally {
			closeSync(lock);
			if (existsSync(temporary)) unlinkSync(temporary);
			unlinkSync(lock_path);
		}
	}
	initialize<T>(value: T, actor: string): EvolutionVersion<T> {
		const file = this.load();
		if (file.active_version)
			throw new Error('Evolution store is already initialized');
		const version: EvolutionVersion<T> = {
			version_id: randomUUID(),
			recommendation_id: 'baseline',
			value,
			value_hash: sha(value),
			actor,
			created_at: now(),
			status: 'active',
			scope: { projects: [], workflow_kinds: [] },
		};
		file.versions[version.version_id] = version as EvolutionVersion;
		file.active_version = version.version_id;
		this.save(file);
		return version;
	}
	register(recommendation: FactoryRecommendation): void {
		assert_safe(recommendation);
		const file = this.load();
		file.recommendations[recommendation.recommendation_id] =
			recommendation;
		this.save(file);
	}
	apply_canary(
		recommendation: FactoryRecommendation,
		input: {
			actor: string;
			projects: string[];
			workflow_kinds: string[];
		},
	): EvolutionVersion<Record<string, unknown>> {
		assert_safe(recommendation);
		if (recommendation.status !== 'approved')
			throw new Error(
				'Human approval is required before canary activation',
			);
		if (
			!recommendation.approval ||
			recommendation.approval.payload_hash !==
				sha(recommendation_payload(recommendation))
		)
			throw new Error('Recommendation changed after human approval');
		if (!input.actor.trim())
			throw new Error('Canary actor is required');
		if (!input.projects.length && !input.workflow_kinds.length)
			throw new Error('Canary scope is required');
		if (input.projects.some((project) => !isAbsolute(project)))
			throw new Error(
				'Canary project scopes must be canonical workspace paths',
			);
		const projects = [
			...new Set(input.projects.map((item) => resolve(item))),
		];
		const workflow_kinds = [...new Set(input.workflow_kinds)];
		const file = this.load();
		const parent = file.active_version;
		if (parent !== recommendation.rollback.prior_version)
			throw new Error(
				'Active version changed; recommendation must be regenerated',
			);
		const parent_version = parent ? file.versions[parent] : undefined;
		if (
			!parent_version ||
			!parent_version.value ||
			typeof parent_version.value !== 'object' ||
			Array.isArray(parent_version.value)
		)
			throw new Error(
				'Active evolution version is not a patchable object',
			);
		const value: Record<string, unknown> = {
			...(parent_version.value as Record<string, unknown>),
			[recommendation.target.field]: recommendation.proposed_value,
		};
		const version: EvolutionVersion<Record<string, unknown>> = {
			version_id: randomUUID(),
			parent_version: parent,
			recommendation_id: recommendation.recommendation_id,
			value,
			value_hash: sha(value),
			actor: input.actor,
			created_at: now(),
			status: 'canary',
			scope: {
				projects,
				workflow_kinds,
			},
		};
		file.versions[version.version_id] = version as EvolutionVersion;
		recommendation.status = 'canary';
		recommendation.canary = {
			version_id: version.version_id,
			projects,
			workflow_kinds,
			started_at: now(),
		};
		recommendation.history.push({
			status: 'canary',
			at: now(),
			actor: input.actor,
			reason: 'Approved bounded canary activated',
		});
		file.recommendations[recommendation.recommendation_id] =
			recommendation;
		this.save(file);
		return version;
	}
	promote(
		version_id: string,
		actor: string,
		report: CalibrationReport,
		production_key: string,
		experimental_key: string,
	): EvolutionVersion {
		const file = this.load();
		const version = file.versions[version_id];
		if (!version) throw new Error('Unknown evolution version');
		if (!actor.trim()) throw new Error('Promotion actor is required');
		if (version.status !== 'canary')
			throw new Error('Only an active canary can be promoted');
		if (file.active_version !== version.parent_version)
			throw new Error(
				'Active version changed while the canary was running',
			);
		const pinned_recommendation =
			file.recommendations[version.recommendation_id];
		if (!pinned_recommendation)
			throw new Error('Canary recommendation is missing');
		if (
			report.fingerprint ===
			pinned_recommendation.evidence_fingerprint
		)
			throw new Error(
				'Promotion requires new post-canary calibration evidence',
			);
		if (
			!Number.isFinite(Date.parse(report.created_at)) ||
			Date.parse(report.created_at) < Date.parse(version.created_at)
		)
			throw new Error('Promotion report predates the canary');
		const experimental = report.cohorts.find(
			(item) => item.key === experimental_key,
		);
		if (
			experimental?.pins.evolution_version_id !== version.version_id
		)
			throw new Error(
				'Experimental cohort is not pinned to this canary version',
			);
		if (
			!controlled_experiment_matches(
				report,
				production_key,
				experimental_key,
				pinned_recommendation.target.field,
			) ||
			cohort_value(
				report,
				production_key,
				pinned_recommendation.target.field,
			) !== pinned_recommendation.current_value ||
			cohort_value(
				report,
				experimental_key,
				pinned_recommendation.target.field,
			) !== pinned_recommendation.proposed_value
		)
			throw new Error(
				'Post-canary report does not evaluate the approved change',
			);
		const comparison = compare_calibration_cohorts(
			report,
			production_key,
			experimental_key,
		);
		if (
			!comparison.comparable ||
			Object.entries(comparison.deltas).some(([metric, delta]) =>
				metric.includes('success') ? delta < 0 : delta > 0,
			)
		)
			throw new Error('Regression blocks canary promotion');
		const parent = version.parent_version
			? file.versions[version.parent_version]
			: undefined;
		if (parent?.status === 'active') parent.status = 'superseded';
		version.status = 'active';
		file.active_version = version_id;
		const recommendation =
			file.recommendations[version.recommendation_id];
		if (recommendation) {
			recommendation.status = 'promoted';
			recommendation.history.push({
				status: 'promoted',
				at: now(),
				actor,
				reason: `Canary passed report ${report.report_id}`,
			});
		}
		this.save(file);
		return version;
	}
	rollback(
		version_id: string,
		actor: string,
		reason: string,
	): EvolutionVersion {
		const file = this.load();
		const version = file.versions[version_id];
		if (!version) throw new Error('Unknown evolution version');
		if (!actor.trim() || !reason.trim())
			throw new Error('Rollback actor and reason are required');
		if (version.status === 'rolled-back') return version;
		const was_active = file.active_version === version_id;
		version.status = 'rolled-back';
		version.rollback_to = version.parent_version;
		if (was_active) {
			file.active_version = version.parent_version;
			const parent = version.parent_version
				? file.versions[version.parent_version]
				: undefined;
			if (parent) parent.status = 'active';
		}
		const recommendation =
			file.recommendations[version.recommendation_id];
		if (recommendation) {
			recommendation.status = 'rolled-back';
			recommendation.history.push({
				status: 'rolled-back',
				at: now(),
				actor,
				reason,
			});
		}
		this.save(file);
		return version;
	}
	get(): EvolutionFile {
		return this.load();
	}
}

export function evolution_dispatch_context(
	version: EvolutionVersion,
): {
	version_id: string;
	recommendation_id: string;
	status: 'canary' | 'active';
	projects: string[];
	workflow_kinds: string[];
	patch: Record<string, unknown>;
} {
	if (version.status !== 'canary' && version.status !== 'active')
		throw new Error(
			'Only canary or active evolution versions can affect routing',
		);
	if (
		!version.value ||
		typeof version.value !== 'object' ||
		Array.isArray(version.value)
	)
		throw new Error(
			'Evolution version does not contain a route patch',
		);
	return {
		version_id: version.version_id,
		recommendation_id: version.recommendation_id,
		status: version.status,
		projects: version.scope.projects,
		workflow_kinds: version.scope.workflow_kinds,
		patch: version.value as Record<string, unknown>,
	};
}

export function apply_evolution_to_route(
	route: ResolvedRoute,
	version: EvolutionVersion,
	project_id: string,
): ResolvedRoute {
	const applies =
		(!version.scope.projects.length ||
			version.scope.projects.includes(project_id)) &&
		(!version.scope.workflow_kinds.length ||
			version.scope.workflow_kinds.includes(route.workflow.id));
	if (!applies) return structuredClone(route);
	const resolved = structuredClone(route);
	for (const [field, value] of Object.entries(
		version.value as Record<string, unknown>,
	)) {
		if (typeof value !== 'number' || !Number.isInteger(value))
			throw new Error(`Evolution field ${field} must be an integer`);
		if (field === 'stall_timeout_ms')
			resolved.workflow.stall_timeout_ms = Math.min(
				resolved.workflow.stall_timeout_ms,
				value,
			);
		else if (field === 'max_parallelism')
			resolved.workflow.compute.parallelism = Math.min(
				resolved.workflow.compute.parallelism,
				value,
			);
		else if (field === 'retry_limit')
			for (const node of resolved.workflow.nodes)
				node.retry_limit = Math.min(node.retry_limit, value);
		else
			throw new Error(
				`Evolution field ${field} is not route-applicable`,
			);
	}
	resolved.policy_sources.push(
		`factory-evolution:${version.version_id}`,
	);
	resolved.rationale.push(
		`Active factory evolution ${version.version_id} from recommendation ${version.recommendation_id}`,
	);
	return resolved;
}
