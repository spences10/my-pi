import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
	create_harness_runtime,
	update_harness_runtime,
} from '@spences10/pi-harness';
import { resolve_project_trust } from '@spences10/pi-project-trust';
import { send_peer_workflow_feedback } from '@spences10/pi-team-mode';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { dispatch_task } from './dispatch.js';
import {
	add_evidence,
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
} from './engine.js';
import { derive_factory_metrics } from './metrics.js';
import {
	DEFAULT_REPOSITORY_POLICY,
	load_repository_policy,
} from './policy.js';
import { run_validation_node } from './runner.js';
import type {
	ApprovalAction,
	RepositoryPolicy,
	ReviewerFinding,
	TaskIntake,
	WorkflowKind,
} from './types.js';

const literals = <T extends readonly string[]>(values: T) =>
	Type.Union(values.map((value) => Type.Literal(value)));
const action_schema = literals([
	'preview',
	'create',
	'status',
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
	'metrics',
	'stalls',
] as const);
const params_schema = Type.Object({
	action: action_schema,
	workflow_id: Type.Optional(Type.String()),
	task: Type.Optional(Type.String({ maxLength: 32_768 })),
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
export function resolve_factory_owner(
	explicit: string | undefined,
	current_session_id: string,
): string {
	return explicit ?? current_session_id;
}
export function factory_intake_from_extension(input: {
	task: string;
	cwd: string;
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
	const path = join(ctx.cwd, '.pi', 'factory.json');
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
	const store = new FactoryStateStore(
		process.env.MY_PI_FACTORY_DIR ?? default_factory_directory(),
	);
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
			'Preview, create, operate, recover, review, approve, and measure versioned software-factory workflows.',
		promptSnippet:
			'Dispatch and operate governed software-factory workflows',
		promptGuidelines: [
			'Use preview before create so the explained route can be overridden.',
			'Never infer approval from validation, mailbox delivery, silence, or model output.',
			'Team Mode supplies peer evidence only; it does not supervise sessions.',
		],
		parameters: params_schema,
		async execute(_id, params, _signal, _update, ctx) {
			const policy = await policy_for(ctx);
			if (params.action === 'preview' || params.action === 'create') {
				const route = dispatch_task(
					factory_intake_from_extension({
						task: required(params.task, 'task'),
						cwd: ctx.cwd,
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
				const state = create_factory_state(route, owner_session_id);
				const harness = create_harness_runtime(
					{
						task: params.task!,
						cwd: ctx.cwd,
						allowed_paths: route.harness.allowed_paths,
						validation_commands: route.harness.validation_commands,
						allow_test_changes: route.harness.allow_test_changes,
						planner_model: route.workflow.compute.planner.model,
						planner_thinking: route.workflow.compute.planner.thinking,
						executor_model: route.workflow.compute.executor.model,
						executor_thinking:
							route.workflow.compute.executor.thinking,
						reviewer_model: route.workflow.compute.reviewer.model,
						reviewer_thinking:
							route.workflow.compute.reviewer.thinking,
					},
					ctx.cwd,
				);
				state.harness = {
					id: harness.contract.id,
					directory: harness.harness_dir,
					outcome_path: join(harness.harness_dir, 'outcome.json'),
				};
				const harness_evidence = add_evidence(state, {
					kind: 'harness-contract',
					uri: harness.harness_dir,
					summary: `Executable harness ${harness.contract.id}`,
				});
				state.authoritative.artifact_ids.push(harness_evidence.id);
				store.claim(state, owner_session_id, route.affected_paths);
				return text({ state, harness_dir: harness.harness_dir });
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
				case 'status':
					return text(state);
				case 'start-node':
					start_node(
						state,
						required(params.node_id, 'node_id'),
						required(
							params.owner_session_id ?? state.owner_session_id,
							'owner_session_id',
						),
					);
					break;
				case 'complete-node':
					complete_node(
						state,
						required(params.node_id, 'node_id'),
						params.artifact_ids,
					);
					break;
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
					state.status = 'paused';
					break;
				case 'resume':
					resume_state(
						state,
						required(params.owner_session_id, 'owner_session_id'),
					);
					break;
				case 'cancel':
					state.status = 'cancelled';
					for (const claim of state.claims) claim.status = 'released';
					break;
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
