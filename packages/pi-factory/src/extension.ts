import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
	amend_harness_runtime,
	create_harness_runtime,
	update_harness_runtime,
} from '@spences10/pi-harness';
import { resolve_project_trust } from '@spences10/pi-project-trust';
import { send_peer_workflow_feedback } from '@spences10/pi-team-mode';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Type } from 'typebox';
import { dispatch_task, route_fingerprint } from './dispatch.js';
import {
	add_evidence,
	amend_contract,
	complete_node,
	create_factory_state,
	create_review_packet,
	default_factory_directory,
	deliver_feedback_packet,
	detect_stall,
	FactoryStateStore,
	fail_node,
	normalize_feedback,
	record_approval,
	record_initial_review,
	resume_state,
	start_node,
	summarize_factory_state,
} from './engine.js';
import {
	create_rpc_execution_adapter,
	ExecutionController,
	ExecutionRegistry,
	peer_execution_adapter,
	WorkflowOperator,
	type WorkspaceSnapshot,
} from './execution.js';
import type {
	ExternalRoutePreview,
	GithubWorkItem,
	IncidentWorkItem,
	IntakePreview,
} from './intake.js';
import {
	external_workflow_id,
	github_intake_adapter,
	incident_intake_adapter,
	IntakeLedger,
	IntakeLifecycleController,
	preview_external_route,
} from './intake.js';
import { derive_factory_metrics } from './metrics.js';
import type { RepositoryPolicyDraft } from './policy-authoring.js';
import {
	activate_policy_draft,
	discover_with_existing_policy,
	reject_policy_draft,
	validate_policy_draft,
} from './policy-authoring.js';
import {
	DEFAULT_REPOSITORY_POLICY,
	load_repository_policy,
} from './policy.js';
import { run_validation_node } from './runner.js';
import type {
	ApprovalAction,
	FactoryState,
	NodeKind,
	RepositoryPolicy,
	ResolvedRoute,
	ReviewerFinding,
	TaskIntake,
	WorkflowKind,
} from './types.js';

const literals = <T extends readonly string[]>(values: T) =>
	Type.Union(values.map((value) => Type.Literal(value)));
const action_schema = literals([
	'preview',
	'create',
	'policy-discover',
	'policy-validate',
	'policy-reject',
	'policy-activate',
	'intake-preview',
	'intake-reconcile',
	'intake-apply',
	'status',
	'request-transfer',
	'acknowledge-transfer',
	'operate',
	'start-node',
	'complete-node',
	'run-validation',
	'flush-feedback',
	'feedback',
	'evidence',
	'review-packet',
	'review-verdict',
	'approval',
	'pause',
	'resume',
	'cancel',
	'timeout',
	'metrics',
	'stalls',
] as const);
const params_schema = Type.Object({
	action: action_schema,
	workflow_id: Type.Optional(Type.String()),
	task: Type.Optional(Type.String({ maxLength: 32_768 })),
	requested_outcome: Type.Optional(
		Type.String({ maxLength: 32_768 }),
	),
	workflow: Type.Optional(
		literals([
			'chore',
			'feature',
			'ambiguous-bug',
			'ui-copy',
			'database-migration',
			'incident',
			'architecture',
			'safe-release',
		] as const),
	),
	reason: Type.Optional(Type.String({ maxLength: 4096 })),
	affected_paths: Type.Optional(
		Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 1000 }),
	),
	owner_session_id: Type.Optional(Type.String()),
	harness_dir: Type.Optional(Type.String({ maxLength: 2048 })),
	transfer_id: Type.Optional(Type.String()),
	full: Type.Optional(Type.Boolean()),
	requested_side_effects: Type.Optional(
		Type.Array(
			literals([
				'commit',
				'push',
				'deploy',
				'release',
				'destructive',
				'public-contract',
			] as const),
			{ maxItems: 6 },
		),
	),
	urgency: Type.Optional(literals(['normal', 'urgent'] as const)),
	hints: Type.Optional(
		Type.Object({
			workflow: Type.Optional(
				literals([
					'chore',
					'feature',
					'ambiguous-bug',
					'ui-copy',
					'database-migration',
					'incident',
					'architecture',
					'safe-release',
				] as const),
			),
			risk: Type.Optional(
				literals(['low', 'medium', 'high', 'critical'] as const),
			),
			ambiguity: Type.Optional(Type.Boolean()),
			ui: Type.Optional(Type.Boolean()),
			database: Type.Optional(Type.Boolean()),
			release: Type.Optional(Type.Boolean()),
			incident: Type.Optional(Type.Boolean()),
			architecture: Type.Optional(Type.Boolean()),
		}),
	),
	node_id: Type.Optional(Type.String()),
	source: Type.Optional(
		literals([
			'test',
			'check',
			'lsp',
			'browser',
			'diff',
			'database',
			'release',
			'reviewer',
			'manual',
		] as const),
	),
	message: Type.Optional(Type.String({ maxLength: 16_384 })),
	severity: Type.Optional(
		literals(['info', 'warning', 'error', 'critical'] as const),
	),
	required_action: Type.Optional(Type.String({ maxLength: 4096 })),
	contradictory: Type.Optional(Type.Boolean()),
	unsafe_fix: Type.Optional(Type.Boolean()),
	artifact_ids: Type.Optional(
		Type.Array(Type.String(), { maxItems: 100 }),
	),
	acceptance_criteria: Type.Optional(
		Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 }),
	),
	changed_files: Type.Optional(
		Type.Array(Type.String({ maxLength: 2048 }), {
			maxItems: 10_000,
		}),
	),
	constraints: Type.Optional(
		Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 }),
	),
	diff: Type.Optional(Type.String({ maxLength: 1_048_576 })),
	review_id: Type.Optional(Type.String()),
	verdict: Type.Optional(
		literals(['approve', 'changes-requested', 'escalate'] as const),
	),
	findings_json: Type.Optional(Type.String({ maxLength: 65_536 })),
	approval_action: Type.Optional(
		literals([
			'commit',
			'push',
			'deploy',
			'release',
			'destructive',
			'public-contract',
		] as const),
	),
	decision: Type.Optional(
		literals(['approved', 'refused', 'changes-requested'] as const),
	),
	actor: Type.Optional(Type.String({ maxLength: 256 })),
	scope: Type.Optional(Type.String({ maxLength: 4096 })),
	evidence_ids: Type.Optional(
		Type.Array(Type.String(), { maxItems: 100 }),
	),
	policy_json: Type.Optional(Type.String({ maxLength: 1_048_576 })),
	intake_kind: Type.Optional(
		literals(['github', 'incident'] as const),
	),
	intake_json: Type.Optional(Type.String({ maxLength: 1_048_576 })),
	known_projects_json: Type.Optional(
		Type.String({ maxLength: 65_536 }),
	),
	intake_preview_json: Type.Optional(
		Type.String({ maxLength: 1_048_576 }),
	),
	execution_mode: Type.Optional(literals(['rpc', 'peer'] as const)),
	timeout_ms: Type.Optional(Type.Number({ minimum: 0 })),
});
const text = (value: unknown) => ({
	content: [
		{
			type: 'text' as const,
			text:
				typeof value === 'string'
					? value
					: JSON.stringify(value, null, 2),
		},
	],
	details: {},
});
export function validate_adoptable_harness(
	route: ResolvedRoute,
	requested_directory: string,
): { harness_dir: string; contract: { id: string } } {
	const directory = resolve(requested_directory);
	const contract_path = join(directory, 'harness.json');
	if (!existsSync(contract_path))
		throw new Error(
			'Requested harness is incompatible: harness.json is missing',
		);
	const contract = JSON.parse(
		readFileSync(contract_path, 'utf8'),
	) as {
		id?: string;
		policy?: { cwd?: string };
		scaffold?: {
			task?: string;
			allowed_paths?: string[];
			validation_commands?: string[];
			allow_test_changes?: boolean;
		};
	};
	const compatible =
		typeof contract.id === 'string' &&
		resolve(contract.policy?.cwd ?? '') ===
			resolve(route.workspace.cwd) &&
		contract.scaffold?.task === route.contract.task &&
		JSON.stringify(contract.scaffold.allowed_paths ?? []) ===
			JSON.stringify(route.harness.allowed_paths) &&
		JSON.stringify(contract.scaffold.validation_commands ?? []) ===
			JSON.stringify(route.harness.validation_commands) &&
		contract.scaffold.allow_test_changes ===
			route.harness.allow_test_changes;
	if (!compatible)
		throw new Error(
			'Requested harness is incompatible with the authoritative factory route',
		);
	return { harness_dir: directory, contract: { id: contract.id! } };
}

export async function reconcile_factory_status(
	state: FactoryState,
	controller: ExecutionController,
	rpc_adapter:
		| ReturnType<typeof create_rpc_execution_adapter>
		| undefined,
	persist: (state: FactoryState) => void,
) {
	const pending = controller.registry
		.list_pending()
		.find(
			(record) => record.request.workflow_id === state.workflow_id,
		);
	if (!pending) return summarize_factory_state(state);
	const refreshed =
		pending.adapter_id === 'pi-rpc' && rpc_adapter
			? await controller.poll(pending, rpc_adapter)
			: controller.registry.mark_lost(
					pending.request.execution_id,
					'Owned execution adapter is unavailable after status reload',
				);
	if (
		['settled', 'succeeded', 'failed', 'cancelled', 'lost'].includes(
			refreshed.lifecycle,
		)
	) {
		controller.apply_result(state, refreshed);
		persist(state);
		return summarize_factory_state(state);
	}
	return summarize_factory_state(state, {
		execution_id: refreshed.request.execution_id,
		lifecycle: refreshed.lifecycle,
		adapter_id: refreshed.adapter_id,
		owner_session_id: refreshed.request.owner_session_id,
		updated_at: refreshed.updated_at,
	});
}

export async function control_factory_execution(
	state: FactoryState,
	operator: WorkflowOperator,
	action: 'pause' | 'resume' | 'cancel' | 'timeout',
	options: {
		owner_session_id: string;
		timeout_ms?: number;
		reason?: string;
	},
	persist: (state: FactoryState) => void,
): Promise<void> {
	const claim = state.claims.find((item) => item.status === 'active');
	if (claim && claim.owner_session_id !== options.owner_session_id)
		throw new Error(
			'Only the active mutating owner may control owned execution',
		);
	if (action === 'pause') await operator.pause_active(state);
	else if (action === 'resume') await operator.resume_active(state);
	else if (action === 'timeout')
		await operator.timeout_active(
			state,
			options.timeout_ms ?? state.route.workflow.stall_timeout_ms,
		);
	else {
		await operator.cancel_active(
			state,
			options.reason ?? 'Factory workflow cancelled',
		);
		state.status = 'cancelled';
		for (const item of state.claims) item.status = 'released';
		persist(state);
	}
}

export function resolve_factory_owner(
	explicit: string | undefined,
	current_session_id: string,
): string {
	return explicit ?? current_session_id;
}
export function assert_child_factory_authority(
	action: string,
	workflow_id: string | undefined,
	environment: NodeJS.ProcessEnv = process.env,
): void {
	if (environment.PI_FACTORY_CONTROL_PLANE !== 'read-only') return;
	const child_workflow_id = environment.PI_FACTORY_WORKFLOW_ID;
	const role = environment.PI_FACTORY_CHILD_ROLE ?? 'child';
	if (action === 'status' && workflow_id === child_workflow_id)
		return;
	if (action === 'operate' && workflow_id === child_workflow_id)
		throw new Error(
			`Recursive self-operation rejected: ${role} child cannot operate workflow ${child_workflow_id}`,
		);
	throw new Error(
		`Least-authority child rejected factory action ${action}; ${role} may not mutate or inspect another control-plane workflow`,
	);
}
export function capture_git_workspace(
	state: FactoryState,
): WorkspaceSnapshot {
	const cwd = state.route.workspace.cwd;
	const run = (args: string[]): string => {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf8',
			timeout: 30_000,
			maxBuffer: 8 * 1024 * 1024,
		});
		if (result.status !== 0)
			throw new Error(
				`Controller workspace snapshot failed: ${result.stderr || result.error?.message || 'git unavailable'}`,
			);
		return result.stdout.trim();
	};
	const paths = new Set([
		...run([
			'diff',
			'--name-only',
			'--diff-filter=ACMRTUXB',
			'HEAD',
			'--',
		]).split(/\r?\n/),
		...run(['ls-files', '--others', '--exclude-standard']).split(
			/\r?\n/,
		),
	]);
	paths.delete('');
	const files: Record<string, string> = {};
	for (const path of paths) {
		const absolute = resolve(cwd, path);
		files[path] = existsSync(absolute)
			? createHash('sha256')
					.update(readFileSync(absolute))
					.digest('hex')
			: '<deleted>';
	}
	return { head: run(['rev-parse', 'HEAD']), files };
}
export function assert_manual_node_authority(
	node_kind: NodeKind | undefined,
	action: 'start' | 'complete',
): void {
	if (node_kind && ['approval', 'complete'].includes(node_kind))
		return;
	throw new Error(
		`Execution, review, and validation nodes can only be ${action === 'start' ? 'started' : 'completed'} by the authoritative controller`,
	);
}
export function factory_intake_from_extension(input: {
	task: string;
	cwd: string;
	acceptance_criteria?: string[];
	constraints?: string[];
	requested_outcome?: string;
	affected_paths?: string[];
	requested_side_effects?: ApprovalAction[];
	urgency?: TaskIntake['urgency'];
	hints?: TaskIntake['hints'];
}): TaskIntake {
	return { ...input };
}
function review_verdict(
	value: string | undefined,
): 'approve' | 'changes-requested' | 'escalate' {
	if (
		value === 'approve' ||
		value === 'changes-requested' ||
		value === 'escalate'
	)
		return value;
	throw new Error('verdict is required');
}
function evidence_kind(source: string | undefined): string {
	return source && source !== 'manual'
		? `validation:${source}`
		: 'manual';
}
function required<T extends string>(
	value: T | undefined,
	name: string,
): T {
	if (!value) throw new Error(`${name} is required`);
	return value;
}
function parse_object(
	value: string | undefined,
	name: string,
): Record<string, unknown> {
	const parsed: unknown = JSON.parse(required(value, name));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error(`${name} must contain an object`);
	return parsed as Record<string, unknown>;
}
function external_intake_from_params(
	params: {
		intake_kind?: 'github' | 'incident';
		intake_json?: string;
		known_projects_json?: string;
	},
	cwd: string,
) {
	const input = parse_object(params.intake_json, 'intake_json');
	const projects = parse_object(
		params.known_projects_json,
		'known_projects_json',
	);
	const known_projects = Object.fromEntries(
		Object.entries(projects).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === 'string',
		),
	);
	const context = { cwd, known_projects };
	if (params.intake_kind === 'github')
		return github_intake_adapter.adapt(
			input as unknown as GithubWorkItem,
			context,
		);
	if (params.intake_kind === 'incident')
		return incident_intake_adapter.adapt(
			input as unknown as IncidentWorkItem,
			context,
		);
	throw new Error('intake_kind is required');
}
function intake_human_overrides(params: {
	task?: string;
	affected_paths?: string[];
	requested_side_effects?: ApprovalAction[];
	urgency?: TaskIntake['urgency'];
	hints?: TaskIntake['hints'];
}): Partial<TaskIntake> {
	return {
		...(params.task ? { task: params.task } : {}),
		...(params.affected_paths
			? { affected_paths: params.affected_paths }
			: {}),
		...(params.requested_side_effects
			? { requested_side_effects: params.requested_side_effects }
			: {}),
		...(params.urgency ? { urgency: params.urgency } : {}),
		...(params.hints ? { hints: params.hints } : {}),
	};
}
function parse_intake_preview(
	value: string | undefined,
): IntakePreview {
	const parsed = parse_object(value, 'intake_preview_json');
	const candidate =
		parsed.preview &&
		typeof parsed.preview === 'object' &&
		!Array.isArray(parsed.preview)
			? parsed.preview
			: parsed;
	return candidate as unknown as IntakePreview;
}
function parse_external_route_preview(
	value: string | undefined,
): ExternalRoutePreview {
	const parsed = parse_object(value, 'intake_preview_json');
	if (
		!parsed.preview ||
		typeof parsed.preview !== 'object' ||
		Array.isArray(parsed.preview) ||
		!parsed.route ||
		typeof parsed.route !== 'object' ||
		Array.isArray(parsed.route)
	)
		throw new Error(
			'intake_preview_json must contain the reviewed intake preview and explained route',
		);
	return parsed as unknown as ExternalRoutePreview;
}
function parse_policy_draft(
	value: string | undefined,
): RepositoryPolicyDraft {
	const parsed: unknown = JSON.parse(required(value, 'policy_json'));
	if (!parsed || typeof parsed !== 'object')
		throw new Error('policy_json must contain a policy draft object');
	const draft = parsed as RepositoryPolicyDraft;
	validate_policy_draft(draft);
	return draft;
}
function parse_findings(
	value: string | undefined,
): ReviewerFinding[] {
	if (!value) return [];
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed))
		throw new Error('findings_json must be an array');
	return parsed.map((item) => {
		if (!item || typeof item !== 'object')
			throw new Error('Invalid reviewer finding');
		const finding = item as Record<string, unknown>;
		if (
			!['info', 'warning', 'error', 'critical'].includes(
				String(finding.severity),
			) ||
			!['must-fix', 'should-fix', 'note'].includes(
				String(finding.disposition),
			) ||
			typeof finding.code !== 'string' ||
			typeof finding.message !== 'string' ||
			typeof finding.required_action !== 'string' ||
			!Array.isArray(finding.evidence_ids)
		)
			throw new Error('Invalid reviewer finding');
		return {
			severity: finding.severity as ReviewerFinding['severity'],
			disposition:
				finding.disposition as ReviewerFinding['disposition'],
			code: finding.code,
			message: finding.message,
			required_action: finding.required_action,
			evidence_ids: finding.evidence_ids.filter(
				(id): id is string => typeof id === 'string',
			),
		};
	});
}
async function policy_for(
	ctx: ExtensionContext,
): Promise<RepositoryPolicy> {
	const path = join(ctx.cwd, CONFIG_DIR_NAME, 'factory.json');
	if (!existsSync(path)) return DEFAULT_REPOSITORY_POLICY;
	const trust = await resolve_project_trust(
		{
			kind: 'factory-policy',
			id: path,
			store_key: path,
			env_key: 'MY_PI_FACTORY_PROJECT_POLICY',
			prompt_title:
				'Project factory policy controls validation commands and workflow routing. Trust it?',
			summary_lines: [`- ${path}`],
		},
		{
			has_ui: ctx.hasUI,
			select: ctx.hasUI
				? async (message, choices) =>
						(await ctx.ui.select(message, choices)) ?? choices.at(-1)!
				: undefined,
		},
	);
	return trust.action === 'skip' || trust.action === 'fallback'
		? DEFAULT_REPOSITORY_POLICY
		: load_repository_policy(path);
}
export default async function factory(pi: ExtensionAPI) {
	const directory =
		process.env.MY_PI_FACTORY_DIR ?? default_factory_directory();
	const store = new FactoryStateStore(directory);
	const execution_controller = new ExecutionController(
		new ExecutionRegistry(
			join(directory, 'executions', 'registry.json'),
		),
		capture_git_workspace,
	);
	let rpc_adapter:
		| ReturnType<typeof create_rpc_execution_adapter>
		| undefined;
	function owned_rpc_adapter() {
		if (rpc_adapter) return rpc_adapter;
		const configured_command = process.env.MY_PI_FACTORY_RPC_COMMAND;
		const configured_args = process.env.MY_PI_FACTORY_RPC_ARGS;
		const command = configured_command ?? process.execPath;
		const args = configured_args
			? (JSON.parse(configured_args) as unknown)
			: [
					required(process.argv[1], 'Pi CLI entrypoint'),
					'--mode',
					'rpc',
					'--no-session',
					'--no-approve',
					'--exclude-tools',
					'factory',
				];
		if (
			!Array.isArray(args) ||
			args.some((item) => typeof item !== 'string')
		)
			throw new Error(
				'MY_PI_FACTORY_RPC_ARGS must be a JSON string array',
			);
		rpc_adapter = create_rpc_execution_adapter({
			command,
			args,
			cwd: process.cwd(),
		});
		return rpc_adapter;
	}
	function harness_for_route(
		route: ResolvedRoute,
		requested_directory?: string,
	) {
		if (!requested_directory)
			return create_harness_runtime(
				{
					task: route.contract.task,
					cwd: route.workspace.cwd,
					allowed_paths: route.harness.allowed_paths,
					validation_commands: route.harness.validation_commands,
					allow_test_changes: route.harness.allow_test_changes,
					planner_model: route.workflow.compute.planner.model,
					planner_thinking: route.workflow.compute.planner.thinking,
					executor_model: route.workflow.compute.executor.model,
					executor_thinking: route.workflow.compute.executor.thinking,
					reviewer_model: route.workflow.compute.reviewer.model,
					reviewer_thinking: route.workflow.compute.reviewer.thinking,
				},
				route.workspace.cwd,
			);
		return validate_adoptable_harness(route, requested_directory);
	}
	function initialize_workflow(
		route: ResolvedRoute,
		owner_session_id: string,
		requested_harness_dir?: string,
	) {
		const path = store.path(route.route_id);
		if (existsSync(path)) {
			const state = store.load(route.route_id);
			if (
				requested_harness_dir &&
				resolve(requested_harness_dir) !==
					resolve(state.harness?.directory ?? '')
			)
				throw new Error(
					'Workflow already has a different authoritative harness; duplicate adoption rejected',
				);
			return {
				state,
				harness_dir: state.harness?.directory,
			};
		}
		const state = create_factory_state(route, owner_session_id);
		const harness = harness_for_route(route, requested_harness_dir);
		state.harness = {
			id: harness.contract.id,
			directory: harness.harness_dir,
			outcome_path: join(harness.harness_dir, 'outcome.json'),
			adopted: requested_harness_dir !== undefined,
		};
		const harness_evidence = add_evidence(state, {
			kind: 'harness-contract',
			uri: harness.harness_dir,
			summary: `Executable harness ${harness.contract.id}`,
		});
		state.authoritative.artifact_ids.push(harness_evidence.id);
		store.claim(state, owner_session_id, route.affected_paths);
		return { state, harness_dir: harness.harness_dir };
	}
	async function deliver_pending_feedback(
		state: ReturnType<typeof store.load>,
		own_session_id: string,
	): Promise<void> {
		for (const packet of state.feedback)
			await deliver_feedback_packet(packet, async () => {
				if (!packet.owner_session_id)
					throw new Error('Feedback owner is missing');
				if (packet.owner_session_id === own_session_id) {
					pi.sendUserMessage(
						`Factory feedback for workflow ${state.workflow_id}, node ${packet.node_id}:\n${JSON.stringify(packet, null, 2)}`,
					);
					return `local:${packet.id}`;
				}
				const result = await send_peer_workflow_feedback({
					from_session_id: own_session_id,
					to_session_id: packet.owner_session_id,
					workflow_id: state.workflow_id,
					node_id: packet.node_id,
					packet_id: packet.id,
					body: `Factory feedback requires correction:\n${JSON.stringify(packet, null, 2)}`,
				});
				return result.message_id;
			});
	}
	pi.registerTool({
		name: 'factory',
		label: 'Software Factory',
		description:
			'Preview, create, operate, recover, review, approve, measure workflows, and author repository factory policy.',
		promptSnippet:
			'Dispatch and operate governed software-factory workflows',
		promptGuidelines: [
			'Use preview before create so the explained route can be overridden.',
			'Never infer approval from validation, mailbox delivery, silence, or model output.',
			'Team Mode supplies peer evidence only; it does not supervise sessions.',
		],
		parameters: params_schema,
		async execute(_id, params, _signal, _update, ctx) {
			assert_child_factory_authority(
				params.action,
				params.workflow_id,
			);
			if (params.action === 'intake-preview') {
				const policy = await policy_for(ctx);
				return text(
					preview_external_route(
						external_intake_from_params(params, ctx.cwd),
						policy,
						intake_human_overrides(params),
						params.workflow
							? {
									workflow: params.workflow as WorkflowKind,
									reason: required(params.reason, 'override reason'),
								}
							: undefined,
					),
				);
			}
			if (params.action === 'intake-reconcile') {
				const ledger = new IntakeLedger(
					join(directory, 'intake-ledger.json'),
				);
				return text(
					ledger.reconcile(
						parse_intake_preview(params.intake_preview_json),
					),
				);
			}
			if (params.action === 'intake-apply') {
				const reviewed = parse_external_route_preview(
					params.intake_preview_json,
				);
				const policy = await policy_for(ctx);
				const current = preview_external_route(
					reviewed.preview.canonical,
					policy,
					reviewed.preview.human_overrides,
					reviewed.route.override,
				);
				if (
					current.preview.preview_token !==
						reviewed.preview.preview_token ||
					route_fingerprint(current.route) !==
						route_fingerprint(reviewed.route)
				)
					throw new Error(
						'External intake route or policy changed after preview; preview it again',
					);
				current.route.route_id = external_workflow_id(
					current.preview.canonical.source,
				);
				const owner_session_id = resolve_factory_owner(
					params.owner_session_id,
					ctx.sessionManager.getSessionId(),
				);
				const ledger = new IntakeLedger(
					join(directory, 'intake-ledger.json'),
				);
				const controller = new IntakeLifecycleController(ledger, {
					create: (_preview) =>
						initialize_workflow(current.route, owner_session_id).state
							.workflow_id,
					update: (workflow_id, preview) => {
						const state = store.load(workflow_id);
						const route = dispatch_task(
							preview.resolved,
							policy,
							reviewed.route.override,
						);
						route.route_id = workflow_id;
						amend_contract(state, route);
						if (!state.harness)
							throw new Error(
								'Workflow has no authoritative harness to amend',
							);
						const contract = amend_harness_runtime({
							harness_dir: state.harness.directory,
							reason:
								'Factory task contract amended by reconciled intake',
							requested_by: 'user',
							task: preview.resolved.task,
							allowed_paths: route.harness.allowed_paths,
							validation_commands: route.harness.validation_commands,
							allow_test_changes: route.harness.allow_test_changes,
							planner_model: route.workflow.compute.planner.model,
							planner_thinking:
								route.workflow.compute.planner.thinking,
							executor_model: route.workflow.compute.executor.model,
							executor_thinking:
								route.workflow.compute.executor.thinking,
							reviewer_model: route.workflow.compute.reviewer.model,
							reviewer_thinking:
								route.workflow.compute.reviewer.thinking,
						});
						add_evidence(state, {
							kind: 'harness-contract',
							uri: state.harness.directory,
							summary: `Authoritative harness ${contract.id} amended in place`,
						});
						for (const claim of state.claims)
							claim.status = 'released';
						store.claim(
							state,
							owner_session_id,
							route.affected_paths,
						);
					},
					pause: (workflow_id) => {
						const state = store.load(workflow_id);
						state.status = 'paused';
						store.save(state);
					},
					cancel: (workflow_id) => {
						const state = store.load(workflow_id);
						state.status = 'cancelled';
						for (const claim of state.claims)
							claim.status = 'released';
						store.save(state);
					},
					resume: (workflow_id) => {
						const state = store.load(workflow_id);
						resume_state(state, owner_session_id);
						store.save(state);
					},
				});
				const result = controller.process(current.preview);
				return text({
					result,
					state: result.entry.workflow_id
						? store.load(result.entry.workflow_id)
						: undefined,
				});
			}
			if (params.action === 'policy-discover')
				return text(discover_with_existing_policy(ctx.cwd));
			if (params.action === 'policy-validate') {
				const draft = parse_policy_draft(params.policy_json);
				return text({ valid: true, draft });
			}
			if (params.action === 'policy-reject') {
				const draft = parse_policy_draft(params.policy_json);
				return text(
					reject_policy_draft(
						draft,
						required(params.reason, 'reason'),
					),
				);
			}
			if (params.action === 'policy-activate') {
				if (!ctx.hasUI)
					throw new Error(
						'Headless factory tools cannot activate generated repository policy; use the programmatic API after authenticated human confirmation',
					);
				const draft = parse_policy_draft(params.policy_json);
				const confirmed = await ctx.ui.confirm(
					'Activate generated factory policy?',
					`Write reviewed policy ${draft.policy.policy_id} to ${draft.activation.target}? This does not grant deployment or destructive permission.`,
				);
				if (!confirmed)
					return text({ activated: false, draft_id: draft.draft_id });
				return text({
					activated: true,
					path: activate_policy_draft(draft, {
						trusted_root: ctx.cwd,
						authorization: {
							kind: 'extension-ui-confirmation',
							actor: ctx.sessionManager.getSessionId(),
						},
					}),
					draft_id: draft.draft_id,
				});
			}
			const policy = await policy_for(ctx);
			if (params.action === 'preview' || params.action === 'create') {
				const route = dispatch_task(
					factory_intake_from_extension({
						task: required(params.task, 'task'),
						cwd: ctx.cwd,
						acceptance_criteria: params.acceptance_criteria,
						constraints: params.constraints,
						requested_outcome: params.requested_outcome,
						affected_paths: params.affected_paths,
						requested_side_effects: params.requested_side_effects,
						urgency: params.urgency,
						hints: params.hints,
					}),
					policy,
					params.workflow
						? {
								workflow: params.workflow as WorkflowKind,
								reason: required(params.reason, 'override reason'),
							}
						: undefined,
				);
				if (params.action === 'preview') return text(route);
				const owner_session_id = resolve_factory_owner(
					params.owner_session_id,
					ctx.sessionManager.getSessionId(),
				);
				return text(
					initialize_workflow(
						route,
						owner_session_id,
						params.harness_dir,
					),
				);
			}
			if (params.action === 'metrics')
				return text(derive_factory_metrics(store.list()));
			if (params.action === 'stalls') {
				const states = store.list();
				for (const state of states) {
					detect_stall(state);
					store.save(state);
				}
				return text(
					states.filter((state) => state.status === 'blocked'),
				);
			}
			const state = store.load(
				required(params.workflow_id, 'workflow_id'),
			);
			switch (params.action) {
				case 'status': {
					const pending = execution_controller.registry
						.list_pending()
						.find(
							(record) =>
								record.request.workflow_id === state.workflow_id,
						);
					const summary = await reconcile_factory_status(
						state,
						execution_controller,
						pending?.adapter_id === 'pi-rpc'
							? owned_rpc_adapter()
							: undefined,
						(current) => store.save(current),
					);
					return text(params.full ? { summary, state } : summary);
				}
				case 'request-transfer': {
					const transfer = store.transfer(
						state,
						ctx.sessionManager.getSessionId(),
						required(params.owner_session_id, 'new owner_session_id'),
					);
					return text({
						transfer,
						state: summarize_factory_state(state),
					});
				}
				case 'acknowledge-transfer': {
					store.acknowledge_transfer(
						state,
						required(params.transfer_id, 'transfer_id'),
						ctx.sessionManager.getSessionId(),
					);
					return text({
						transferred: true,
						state: summarize_factory_state(state),
					});
				}
				case 'operate': {
					const adapter =
						params.execution_mode === 'peer'
							? peer_execution_adapter
							: owned_rpc_adapter();
					const operator = new WorkflowOperator(
						execution_controller,
						{
							plan: adapter,
							execute: adapter,
							review: adapter,
						},
						(current) => store.save(current),
					);
					const records = await operator.progress(state, {
						owner_session_id: resolve_factory_owner(
							params.owner_session_id,
							ctx.sessionManager.getSessionId(),
						),
						task: params.task,
						cwd: state.route.workspace.cwd,
						...(params.changed_files?.length &&
						params.diff !== undefined
							? {
									review: {
										acceptance_criteria: params.acceptance_criteria,
										changed_files: params.changed_files,
										constraints: params.constraints ?? [],
										diff: params.diff,
									},
								}
							: {}),
					});
					await deliver_pending_feedback(
						state,
						ctx.sessionManager.getSessionId(),
					);
					store.save(state);
					return text({ state, executions: records });
				}
				case 'start-node': {
					const node_id = required(params.node_id, 'node_id');
					const node = state.nodes.find(
						(item) => item.id === node_id,
					);
					assert_manual_node_authority(node?.kind, 'start');
					start_node(
						state,
						node_id,
						required(
							params.owner_session_id ?? state.owner_session_id,
							'owner_session_id',
						),
					);
					break;
				}
				case 'complete-node': {
					const node_id = required(params.node_id, 'node_id');
					const node = state.nodes.find(
						(item) => item.id === node_id,
					);
					assert_manual_node_authority(node?.kind, 'complete');
					complete_node(state, node_id, params.artifact_ids);
					break;
				}
				case 'run-validation': {
					const disposition = await run_validation_node(state);
					store.save(state);
					await deliver_pending_feedback(
						state,
						ctx.sessionManager.getSessionId(),
					);
					if (state.harness) {
						try {
							update_harness_runtime({
								harness_dir: state.harness.directory,
								status:
									disposition === 'passed'
										? 'reviewing'
										: disposition === 'escalate'
											? 'failed'
											: 'running',
								phase: `factory:${state.current_node_id ?? 'validation'}`,
								evidence: `Validation disposition: ${disposition}`,
							});
						} catch (error) {
							state.events.push({
								id: crypto.randomUUID(),
								workflow_id: state.workflow_id,
								workflow_version: state.route.workflow.version,
								type: 'harness.update_failed',
								timestamp: new Date().toISOString(),
								metadata: {
									error:
										error instanceof Error
											? error.message.slice(0, 4096)
											: String(error),
								},
							});
						}
					}
					store.save(state);
					return text(state);
				}
				case 'flush-feedback': {
					await deliver_pending_feedback(
						state,
						ctx.sessionManager.getSessionId(),
					);
					store.save(state);
					return text(state.feedback);
				}
				case 'feedback': {
					const node = state.nodes.find(
						(item) => item.id === params.node_id,
					);
					const packet = normalize_feedback({
						workflow_id: state.workflow_id,
						node_id: required(params.node_id, 'node_id'),
						attempt: node?.attempts ?? 0,
						source: (params.source ?? 'check') as 'check',
						owner_session_id: node?.owner_session_id,
						contradictory: params.contradictory ?? false,
						unsafe_fix: params.unsafe_fix ?? false,
						items: [
							{
								severity: (params.severity ?? 'error') as 'error',
								code: 'factory.feedback',
								message: required(params.message, 'message'),
								evidence_ids: params.evidence_ids ?? [],
								required_action: required(
									params.required_action,
									'required_action',
								),
							},
						],
					});
					fail_node(state, packet);
					store.save(state);
					await deliver_pending_feedback(
						state,
						ctx.sessionManager.getSessionId(),
					);
					store.save(state);
					return text(state);
				}
				case 'evidence':
					add_evidence(state, {
						kind: evidence_kind(params.source),
						summary: required(params.message, 'message'),
					});
					break;
				case 'review-packet': {
					if (state.harness) {
						const result = spawnSync(
							'sh',
							[join(state.harness.directory, 'review.sh')],
							{
								cwd: state.route.workspace.cwd,
								encoding: 'utf8',
								timeout: 15 * 60_000,
								maxBuffer: 1024 * 1024,
							},
						);
						const summary =
							`${result.stdout ?? ''}\n${result.stderr ?? ''}`
								.trim()
								.slice(-16_384);
						add_evidence(state, {
							kind: 'validation:harness-review',
							uri: state.harness.outcome_path,
							summary,
						});
						if (result.status !== 0)
							throw new Error(`Harness review failed: ${summary}`);
					}
					create_review_packet(
						state,
						params.acceptance_criteria ?? [],
						params.changed_files ?? [],
						params.constraints ?? [],
						params.diff ?? '',
					);
					break;
				}
				case 'review-verdict': {
					const packet = record_initial_review(
						state,
						required(params.review_id, 'review_id'),
						review_verdict(params.verdict),
						parse_findings(params.findings_json),
						required(params.diff, 'current diff'),
					);
					if (packet) {
						store.save(state);
						await deliver_pending_feedback(
							state,
							ctx.sessionManager.getSessionId(),
						);
						store.save(state);
						return text(state);
					}
					break;
				}
				case 'approval': {
					if (!ctx.hasUI)
						throw new Error(
							'Headless factory tools cannot grant approval; the embedding application must collect a human decision and call the programmatic API',
						);
					const action = required(
						params.approval_action,
						'approval_action',
					) as ApprovalAction;
					const decision = required(
						params.decision,
						'decision',
					) as 'approved';
					const confirmed = await ctx.ui.confirm(
						`Record ${decision} for ${action}?`,
						`Actor: ${required(params.actor, 'actor')}\nScope: ${required(params.scope, 'scope')}`,
					);
					if (!confirmed)
						throw new Error(
							'Human approval confirmation was not granted',
						);
					record_approval(state, {
						action,
						actor: params.actor!,
						decision,
						scope: params.scope!,
						evidence_ids: params.evidence_ids ?? [],
						authentication: 'extension-ui-confirmation',
					});
					break;
				}
				case 'pause':
				case 'resume':
				case 'cancel':
				case 'timeout': {
					const adapter = owned_rpc_adapter();
					const operator = new WorkflowOperator(
						execution_controller,
						{
							plan: adapter,
							execute: adapter,
							review: adapter,
						},
						(current) => store.save(current),
					);
					await control_factory_execution(
						state,
						operator,
						params.action,
						{
							owner_session_id: resolve_factory_owner(
								params.owner_session_id,
								ctx.sessionManager.getSessionId(),
							),
							timeout_ms: params.timeout_ms,
							reason: params.reason,
						},
						(current) => store.save(current),
					);
					return text(state);
				}
			}
			store.save(state);
			return text(state);
		},
	});
	pi.registerCommand('factory', {
		description:
			'Preview, start, inspect, resume, and measure software-factory workflows',
		handler: async (args, ctx) => {
			const [command = 'status', ...rest] = args.trim().split(/\s+/);
			if (command === 'start' || command === 'preview') {
				pi.sendUserMessage(
					`Use the factory tool action=${command === 'start' ? 'create' : 'preview'} for this task. Explain the resolved route and unresolved assumptions before execution.\n\n${rest.join(' ')}`,
				);
				return;
			}
			if (command === 'metrics') {
				pi.sendUserMessage(
					'Use the factory tool action=metrics and summarize workflow/version bottlenecks.',
				);
				return;
			}
			if (
				command === 'status' ||
				command === 'resume' ||
				command === 'cancel'
			) {
				const id = rest[0];
				if (!id)
					return ctx.ui.notify(
						`Usage: /factory ${command} <workflow-id>`,
						'warning',
					);
				pi.sendUserMessage(
					`Use the factory tool action=${command} workflow_id=${id}${command === 'resume' ? ' and set owner_session_id to this session id' : ''}.`,
				);
				return;
			}
			ctx.ui.notify(
				'Usage: /factory preview|start <task> | status|resume|cancel <id> | metrics',
				'info',
			);
		},
	});
}
