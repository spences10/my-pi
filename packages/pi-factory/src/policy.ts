import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get_workflow } from './catalog.js';
import {
	FACTORY_SCHEMA_VERSION,
	type ApprovalAction,
	type RepositoryPolicy,
	type WorkflowDefinition,
	type WorkflowKind,
} from './types.js';

const approval_rank: ApprovalAction[] = [
	'commit',
	'push',
	'deploy',
	'release',
	'destructive',
	'public-contract',
];
function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}
const workflow_kinds = new Set([
	'chore',
	'feature',
	'ambiguous-bug',
	'ui-copy',
	'database-migration',
	'incident',
	'architecture',
	'safe-release',
]);
const risks = new Set(['low', 'medium', 'high', 'critical']);
const approval_actions = new Set(approval_rank);
function object(
	value: unknown,
	path: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}
function string_array(value: unknown, path: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== 'string')
	)
		throw new Error(`${path} must be a string array`);
	return value;
}
export function validate_repository_policy(
	input: unknown,
): asserts input is RepositoryPolicy {
	const policy = object(input, 'policy');
	const allowed = new Set([
		'schema_version',
		'policy_id',
		'workflow_overrides',
		'validations',
		'risky_paths',
		'forbidden_paths',
		'required_approvals',
		'max_parallelism',
		'stall_timeout_ms',
	]);
	for (const key of Object.keys(policy))
		if (!allowed.has(key))
			throw new Error(`policy.${key} is unknown`);
	if (policy.schema_version !== FACTORY_SCHEMA_VERSION)
		throw new Error(
			`Unsupported factory policy schema version: ${String(policy.schema_version)}`,
		);
	if (
		typeof policy.policy_id !== 'string' ||
		!policy.policy_id.trim()
	)
		throw new Error('Repository policy requires policy_id');
	for (const field of ['risky_paths', 'forbidden_paths'] as const)
		if (policy[field] !== undefined)
			string_array(policy[field], `policy.${field}`);
	if (policy.required_approvals !== undefined)
		for (const action of string_array(
			policy.required_approvals,
			'policy.required_approvals',
		))
			if (!approval_actions.has(action as ApprovalAction))
				throw new Error(
					`policy.required_approvals contains invalid action ${action}`,
				);
	if (
		policy.max_parallelism !== undefined &&
		(!Number.isInteger(policy.max_parallelism) ||
			Number(policy.max_parallelism) < 1)
	)
		throw new Error('max_parallelism must be a positive integer');
	if (
		policy.stall_timeout_ms !== undefined &&
		(!Number.isInteger(policy.stall_timeout_ms) ||
			Number(policy.stall_timeout_ms) < 1)
	)
		throw new Error('stall_timeout_ms must be a positive integer');
	if (policy.validations !== undefined) {
		if (!Array.isArray(policy.validations))
			throw new Error('policy.validations must be an array');
		for (const [index, value] of policy.validations.entries()) {
			const gate = object(value, `policy.validations[${index}]`);
			if (
				typeof gate.id !== 'string' ||
				!['shell', 'tool'].includes(String(gate.execution)) ||
				![
					'test',
					'check',
					'lsp',
					'browser',
					'diff',
					'database',
					'release',
				].includes(String(gate.source)) ||
				typeof gate.required !== 'boolean' ||
				(gate.execution === 'shell' &&
					typeof gate.command !== 'string') ||
				(gate.execution === 'tool' && typeof gate.tool !== 'string')
			)
				throw new Error(`policy.validations[${index}] is invalid`);
		}
	}
	if (policy.workflow_overrides !== undefined)
		for (const [kind, value] of Object.entries(
			object(policy.workflow_overrides, 'policy.workflow_overrides'),
		)) {
			if (!workflow_kinds.has(kind))
				throw new Error(
					`policy.workflow_overrides.${kind} is unknown`,
				);
			const override = object(
				value,
				`policy.workflow_overrides.${kind}`,
			);
			const override_keys = new Set([
				'validation_commands',
				'retry_limit',
				'risk',
				'approvals',
			]);
			for (const key of Object.keys(override))
				if (!override_keys.has(key))
					throw new Error(
						`policy.workflow_overrides.${kind}.${key} is unknown`,
					);
			const base = get_workflow(kind as WorkflowKind);
			if (override.validation_commands !== undefined)
				string_array(
					override.validation_commands,
					`policy.workflow_overrides.${kind}.validation_commands`,
				);
			if (
				override.retry_limit !== undefined &&
				(!Number.isInteger(override.retry_limit) ||
					Number(override.retry_limit) < 0 ||
					Number(override.retry_limit) > 5)
			)
				throw new Error(`Unsafe retry_limit for ${kind}`);
			if (
				override.risk !== undefined &&
				(typeof override.risk !== 'string' ||
					!risks.has(override.risk) ||
					['low', 'medium', 'high', 'critical'].indexOf(
						override.risk,
					) <
						['low', 'medium', 'high', 'critical'].indexOf(base.risk))
			)
				throw new Error(
					`Repository policy cannot lower runtime risk for ${kind}`,
				);
			if (override.approvals !== undefined)
				for (const action of string_array(
					override.approvals,
					`policy.workflow_overrides.${kind}.approvals`,
				))
					if (!approval_actions.has(action as ApprovalAction))
						throw new Error(`Invalid approval ${action}`);
		}
}
export function resolve_workflow_policy(
	kind: WorkflowKind,
	policy: RepositoryPolicy,
): WorkflowDefinition {
	validate_repository_policy(policy);
	const result = get_workflow(kind);
	const override = policy.workflow_overrides?.[kind];
	if (override?.risk) result.risk = override.risk;
	if (override?.retry_limit !== undefined)
		for (const node of result.nodes)
			if (
				node.kind === 'execute' ||
				node.kind === 'validate' ||
				node.kind === 'review'
			)
				node.retry_limit = Math.min(
					node.retry_limit,
					override.retry_limit,
				);
	const extra_commands = override?.validation_commands ?? [];
	for (const [index, command] of extra_commands.entries())
		result.validations.push({
			id: `repository-${index + 1}`,
			execution: 'shell',
			command,
			source: 'check',
			required: true,
		});
	result.validations.push(...(policy.validations ?? []));
	result.approvals = unique([
		...result.approvals,
		...(override?.approvals ?? []),
		...(policy.required_approvals ?? []),
	]);
	if (result.approvals.length) {
		let node = result.nodes.find((item) => item.kind === 'approval');
		if (!node) {
			const complete = result.nodes.find(
				(item) => item.kind === 'complete',
			)!;
			const prior = complete.depends_on;
			node = {
				id: 'approval',
				kind: 'approval',
				depends_on: prior,
				owner_role: 'human',
				retry_limit: 0,
				approval_actions: result.approvals,
			};
			result.nodes.splice(result.nodes.indexOf(complete), 0, node);
			complete.depends_on = ['approval'];
		} else node.approval_actions = result.approvals;
	}
	result.compute.parallelism = Math.min(
		result.compute.parallelism,
		policy.max_parallelism ?? result.compute.parallelism,
	);
	if (policy.stall_timeout_ms !== undefined)
		result.stall_timeout_ms = Math.min(
			result.stall_timeout_ms,
			policy.stall_timeout_ms,
		);
	return result;
}
export function load_repository_policy(
	path: string,
): RepositoryPolicy {
	const parsed = JSON.parse(
		readFileSync(resolve(path), 'utf8'),
	) as unknown;
	validate_repository_policy(parsed);
	return parsed;
}
export const DEFAULT_REPOSITORY_POLICY: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'runtime-default',
	required_approvals: [],
	max_parallelism: 3,
};
export { approval_rank };
