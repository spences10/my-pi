import {
	FACTORY_SCHEMA_VERSION,
	type ApprovalAction,
	type ComputePolicy,
	type ReviewMode,
	type Risk,
	type ValidationGate,
	type WorkflowDefinition,
	type WorkflowKind,
	type WorkflowNodeDefinition,
} from './types.js';

const role = (
	capability: ComputePolicy['planner']['capability'],
	thinking: ComputePolicy['planner']['thinking'],
) => ({ capability, thinking });
const gates: Record<string, ValidationGate> = {
	check: {
		id: 'check',
		execution: 'shell',
		command: 'pnpm run check',
		source: 'check',
		required: true,
	},
	test: {
		id: 'test',
		execution: 'shell',
		command: 'pnpm run test',
		source: 'test',
		required: true,
	},
	lsp: {
		id: 'lsp',
		execution: 'tool',
		tool: 'lsp_diagnostics_many',
		source: 'lsp',
		required: true,
	},
	browser: {
		id: 'browser',
		execution: 'tool',
		tool: 'chrome-devtools',
		source: 'browser',
		required: true,
	},
	database: {
		id: 'database',
		execution: 'tool',
		tool: 'mcp-sqlite-tools',
		source: 'database',
		required: true,
	},
	diff: {
		id: 'diff',
		execution: 'shell',
		command: 'git diff --check',
		source: 'diff',
		required: true,
	},
	release: {
		id: 'release',
		execution: 'shell',
		command: 'pnpm pack --dry-run',
		source: 'release',
		required: true,
	},
};
function nodes(
	validation_ids: string[],
	approvals: ApprovalAction[],
	review: ReviewMode,
	plan = true,
	execute = true,
): WorkflowNodeDefinition[] {
	const result: WorkflowNodeDefinition[] = [];
	if (plan)
		result.push({
			id: 'plan',
			kind: 'plan',
			depends_on: [],
			owner_role: 'planner',
			retry_limit: 0,
		});
	if (execute)
		result.push({
			id: 'execute',
			kind: 'execute',
			depends_on: plan ? ['plan'] : [],
			owner_role: 'executor',
			retry_limit: 2,
		});
	const validation_dependency = result.some(
		(node) => node.id === 'execute',
	)
		? ['execute']
		: plan
			? ['plan']
			: [];
	result.push({
		id: 'validate',
		kind: 'validate',
		depends_on: validation_dependency,
		owner_role: 'executor',
		retry_limit: 2,
		validation_gate_ids: validation_ids,
	});
	if (review !== 'deterministic-only')
		result.push({
			id: 'review',
			kind: 'review',
			depends_on: ['validate'],
			owner_role: 'reviewer',
			retry_limit: 1,
		});
	if (approvals.length)
		result.push({
			id: 'approval',
			kind: 'approval',
			depends_on: [
				review === 'deterministic-only' ? 'validate' : 'review',
			],
			owner_role: 'human',
			retry_limit: 0,
			approval_actions: approvals,
		});
	result.push({
		id: 'complete',
		kind: 'complete',
		depends_on: [
			approvals.length
				? 'approval'
				: review === 'deterministic-only'
					? 'validate'
					: 'review',
		],
		owner_role: 'human',
		retry_limit: 0,
	});
	return result;
}
function workflow(
	id: WorkflowKind,
	description: string,
	risk: Risk,
	compute: ComputePolicy,
	review_mode: ReviewMode,
	validation_ids: string[],
	approvals: ApprovalAction[],
	plan = true,
	execute = true,
): WorkflowDefinition {
	return {
		schema_version: FACTORY_SCHEMA_VERSION,
		id,
		version: '1.0.0',
		description,
		risk,
		compute,
		review_mode,
		validations: validation_ids.map((id) => gates[id]!),
		approvals,
		nodes: nodes(
			validation_ids,
			approvals,
			review_mode,
			plan,
			execute,
		),
		stall_timeout_ms: risk === 'critical' ? 300_000 : 900_000,
	};
}
export const WORKFLOW_CATALOG: Readonly<
	Record<WorkflowKind, WorkflowDefinition>
> = {
	chore: workflow(
		'chore',
		'Bounded maintenance or dependency update',
		'low',
		{
			planner: role('none', 'off'),
			executor: role('cheap', 'low'),
			reviewer: role('none', 'off'),
			parallelism: 1,
			parallelism_reason: 'Routine deterministic change',
		},
		'deterministic-only',
		['check', 'test', 'diff'],
		[],
		false,
	),
	feature: workflow(
		'feature',
		'Production feature with planning and independent review',
		'medium',
		{
			planner: role('strong', 'high'),
			executor: role('medium', 'medium'),
			reviewer: role('strong', 'high'),
			parallelism: 1,
			parallelism_reason: 'Single mutating owner avoids conflicts',
		},
		'model-review',
		['check', 'test', 'lsp', 'diff'],
		['public-contract'],
	),
	'ambiguous-bug': workflow(
		'ambiguous-bug',
		'Bug investigation with bounded parallel hypotheses',
		'high',
		{
			planner: role('strong', 'xhigh'),
			executor: role('medium', 'high'),
			reviewer: role('strong', 'high'),
			parallelism: 2,
			parallelism_reason:
				'At most two read-only hypotheses; one mutating owner',
		},
		'adversarial-peer',
		['check', 'test', 'lsp', 'diff'],
		[],
	),
	'ui-copy': workflow(
		'ui-copy',
		'UI implementation or copy audit with browser evidence',
		'medium',
		{
			planner: role('strong', 'high'),
			executor: role('medium', 'medium'),
			reviewer: role('strong', 'high'),
			parallelism: 1,
			parallelism_reason: 'Integrated visual ownership',
		},
		'model-review',
		['check', 'test', 'browser', 'diff'],
		['public-contract'],
	),
	'database-migration': workflow(
		'database-migration',
		'Schema/data migration with rollback and explicit approval',
		'high',
		{
			planner: role('strongest', 'xhigh'),
			executor: role('specialized', 'high'),
			reviewer: role('strong', 'xhigh'),
			parallelism: 1,
			parallelism_reason:
				'Migration serialization preserves data safety',
		},
		'human-plus-model',
		['check', 'test', 'database', 'diff'],
		['destructive', 'deploy'],
	),
	incident: workflow(
		'incident',
		'Urgent production incident with bounded investigation',
		'critical',
		{
			planner: role('specialized', 'xhigh'),
			executor: role('fast', 'high'),
			reviewer: role('strong', 'high'),
			parallelism: 3,
			parallelism_reason:
				'Parallel read-only diagnosis; one fix owner',
		},
		'human-plus-model',
		['check', 'test', 'diff'],
		['commit', 'push', 'deploy'],
	),
	architecture: workflow(
		'architecture',
		'Research and architecture decision before implementation',
		'medium',
		{
			planner: role('strongest', 'xhigh'),
			executor: role('none', 'off'),
			reviewer: role('strongest', 'xhigh'),
			parallelism: 3,
			parallelism_reason:
				'Independent research and adversarial synthesis',
		},
		'adversarial-peer',
		['diff'],
		['public-contract'],
		true,
		false,
	),
	'safe-release': workflow(
		'safe-release',
		'Release preparation with installability and human release approval',
		'high',
		{
			planner: role('strong', 'high'),
			executor: role('medium', 'medium'),
			reviewer: role('strong', 'xhigh'),
			parallelism: 1,
			parallelism_reason: 'Release state must be serialized',
		},
		'human-plus-model',
		['check', 'test', 'release', 'diff'],
		['commit', 'push', 'release'],
	),
};
export function get_workflow(id: WorkflowKind): WorkflowDefinition {
	return structuredClone(WORKFLOW_CATALOG[id]);
}
