import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { get_workflow } from './catalog.js';
import {
	classify_task,
	dispatch_task,
	route_fingerprint,
} from './dispatch.js';
import {
	add_evidence,
	amend_contract,
	claim_paths,
	complete_node,
	complete_validated_node,
	create_factory_state,
	create_review_packet,
	deliver_feedback_packet,
	detect_stall,
	FactoryStateStore,
	fail_node,
	normalize_feedback,
	record_approval,
	record_initial_review,
	requires_approval,
	resume_state,
	start_node,
} from './engine.js';
import {
	assert_child_factory_authority,
	assert_manual_node_authority,
	capture_git_workspace,
	factory_intake_from_extension,
	resolve_factory_owner,
} from './extension.js';
import {
	correlate_compute,
	derive_factory_metrics,
} from './metrics.js';
import {
	resolve_workflow_policy,
	validate_repository_policy,
} from './policy.js';
import { run_validation_node } from './runner.js';
import type { FactoryState, RepositoryPolicy } from './types.js';

const policy: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'test@1',
	required_approvals: [],
};
const route = (task = 'Implement account feature') =>
	dispatch_task(
		{ task, cwd: '/repo', affected_paths: ['src/account'] },
		policy,
	);
function pass(state: FactoryState, id: string, owner = 'executor') {
	start_node(state, id, owner);
	if (id === 'validate') {
		const definition = state.route.workflow.nodes.find(
			(node) => node.id === id,
		)!;
		for (const gate of definition.validation_gate_ids ?? [])
			add_evidence(state, {
				kind: `validation-gate:${gate}:pass`,
				summary: `${gate} passed`,
			});
		complete_validated_node(state, id);
	} else complete_node(state, id);
}
function feedback(
	state: FactoryState,
	node_id: string,
	options: Partial<{
		contradictory: boolean;
		unsafe_fix: boolean;
	}> = {},
) {
	return normalize_feedback({
		workflow_id: state.workflow_id,
		node_id,
		attempt:
			state.nodes.find((node) => node.id === node_id)?.attempts ?? 0,
		source: 'test',
		owner_session_id: state.nodes.find((node) => node.id === node_id)
			?.owner_session_id,
		contradictory: options.contradictory ?? false,
		unsafe_fix: options.unsafe_fix ?? false,
		items: [
			{
				severity: 'error',
				code: 'test.failed',
				message: 'expected true',
				evidence_ids: [],
				required_action: 'Fix implementation',
			},
		],
	});
}

describe('catalog, policy, and dispatch', () => {
	it('provides eight materially distinct versioned workflows', () => {
		const ids = [
			'chore',
			'feature',
			'ambiguous-bug',
			'ui-copy',
			'database-migration',
			'incident',
			'architecture',
			'safe-release',
		] as const;
		expect(ids.map((id) => get_workflow(id).version)).toEqual(
			Array(8).fill('1.0.0'),
		);
		expect(
			new Set(
				ids.map((id) => JSON.stringify(get_workflow(id).compute)),
			).size,
		).toBeGreaterThan(5);
	});
	it.each([
		['Upgrade dependencies', 'chore'],
		['Debug flaky login bug', 'ambiguous-bug'],
		['Build responsive page', 'ui-copy'],
		['Add database migration', 'database-migration'],
		['Production incident outage', 'incident'],
		['Research architecture options', 'architecture'],
		['Publish release', 'safe-release'],
		['Implement export feature', 'feature'],
	])('classifies %s', (task, expected) =>
		expect(classify_task({ task, cwd: '/repo' }).workflow).toBe(
			expected,
		),
	);
	it('rejects unsupported and conflicting intake', () => {
		expect(() =>
			classify_task({ task: 'ponder it', cwd: '/repo' }),
		).toThrow('Unsupported');
		expect(() =>
			classify_task({
				task: 'work',
				cwd: '/repo',
				hints: { ui: true, database: true },
			}),
		).toThrow('Conflicting');
	});
	it('explains and audits bounded overrides', () => {
		const resolved = dispatch_task(
			{ task: 'Implement feature', cwd: '/repo' },
			policy,
			{ workflow: 'ambiguous-bug', reason: 'Unknown reproduction' },
		);
		expect(resolved.rationale).toContain(
			'Human override: Unknown reproduction',
		);
		expect(resolved.workflow.compute.parallelism).toBe(2);
		expect(resolved.coordination.supervision).toBe(
			'peer-evidence-only',
		);
	});
	it('lets an explicit workflow override rescue ambiguous intake', () => {
		const resolved = dispatch_task(
			{ task: 'ponder it', cwd: '/repo' },
			policy,
			{ workflow: 'architecture', reason: 'Human review decision' },
		);
		expect(resolved.workflow.id).toBe('architecture');
		expect(resolved.assumptions).toContainEqual(
			expect.stringContaining(
				'Automatic classification was bypassed',
			),
		);
	});
	it('preserves an authoritative hashed contract and exposes advisory compute', () => {
		const resolved = dispatch_task(
			{
				task: 'Implement account export',
				cwd: '/repo',
				acceptance_criteria: ['exports CSV', 'preserves permissions'],
				constraints: ['no public API break'],
				requested_outcome: 'A validated account export',
			},
			policy,
		);
		expect(resolved.contract).toMatchObject({
			version: 1,
			task: 'Implement account export',
			acceptance_criteria: ['exports CSV', 'preserves permissions'],
			constraints: ['no public API break'],
			requested_outcome: 'A validated account export',
			status: 'authoritative',
		});
		expect(resolved.contract.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(resolved.workflow.compute.executor.enforcement).toBe(
			'advisory',
		);
	});
	it('strengthens repository-wide semantic work independently of a chore override', () => {
		const resolved = dispatch_task(
			{
				task: 'Remove 196 explicit-any violations across 50 files in a repository-wide semantic TypeScript migration',
				cwd: '/repo',
				affected_paths: Array.from(
					{ length: 50 },
					(_, index) => `src/file-${index}.ts`,
				),
			},
			policy,
			{ workflow: 'chore', reason: 'Requested cheap maintenance' },
		);
		expect(resolved.work_type).toBe('database-migration');
		expect(resolved.override?.workflow).toBe('chore');
		expect(resolved.complexity.level).toBe('critical');
		expect(resolved.workflow.id).toBe('database-migration');
		expect(resolved.workflow.risk).toBe('critical');
		expect(resolved.workflow.approvals).toContain('public-contract');
		expect(resolved.workflow.compute.planner.capability).toBe(
			'strongest',
		);
		expect(resolved.workflow.review_mode).not.toBe(
			'deterministic-only',
		);
		expect(resolved.rationale).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Complexity critical'),
			]),
		);
	});
	it('uses a reproducible route fingerprint independent of route identity', () => {
		const first = route('Implement stable feature');
		const second = route('Implement stable feature');
		expect(first.route_id).not.toBe(second.route_id);
		expect(route_fingerprint(first)).toBe(route_fingerprint(second));
	});
	it('gives child roles read-only access only to their own status', () => {
		const environment = {
			PI_FACTORY_CONTROL_PLANE: 'read-only',
			PI_FACTORY_CHILD_ROLE: 'executor',
			PI_FACTORY_WORKFLOW_ID: 'workflow-1',
		};
		expect(() =>
			assert_child_factory_authority(
				'status',
				'workflow-1',
				environment,
			),
		).not.toThrow();
		expect(() =>
			assert_child_factory_authority(
				'operate',
				'workflow-1',
				environment,
			),
		).toThrow('Recursive self-operation rejected');
		expect(() =>
			assert_child_factory_authority(
				'complete-node',
				'workflow-1',
				environment,
			),
		).toThrow('Least-authority child rejected');
		expect(() =>
			assert_child_factory_authority(
				'status',
				'workflow-2',
				environment,
			),
		).toThrow('may not mutate or inspect another');
	});
	it('reserves execution and review transitions for the controller', () => {
		for (const node_kind of [
			'plan',
			'execute',
			'validate',
			'review',
		] as const) {
			expect(() =>
				assert_manual_node_authority(node_kind, 'start'),
			).toThrow('authoritative controller');
			expect(() =>
				assert_manual_node_authority(node_kind, 'complete'),
			).toThrow('authoritative controller');
		}
		expect(() =>
			assert_manual_node_authority('approval', 'start'),
		).not.toThrow();
		expect(() =>
			assert_manual_node_authority('complete', 'complete'),
		).not.toThrow();
	});
	it('captures the complete git delta and detects reverted edits', () => {
		const directory = mkdtempSync(join(tmpdir(), 'factory-git-'));
		execFileSync('git', ['init', '-q'], { cwd: directory });
		execFileSync(
			'git',
			['config', 'user.email', 'factory@example.test'],
			{
				cwd: directory,
			},
		);
		execFileSync('git', ['config', 'user.name', 'Factory Test'], {
			cwd: directory,
		});
		writeFileSync(join(directory, 'claimed.txt'), 'original\n');
		execFileSync('git', ['add', 'claimed.txt'], { cwd: directory });
		execFileSync('git', ['commit', '-qm', 'fixture'], {
			cwd: directory,
		});
		const state = create_factory_state(
			dispatch_task(
				{
					task: 'Update claimed file',
					cwd: directory,
					affected_paths: ['claimed.txt'],
				},
				policy,
				{ workflow: 'chore', reason: 'Git observer fixture' },
			),
		);
		writeFileSync(join(directory, 'claimed.txt'), 'changed\n');
		writeFileSync(join(directory, 'unrelated.txt'), 'preserve me\n');
		const changed = capture_git_workspace(state);
		expect(Object.keys(changed.files).sort()).toEqual([
			'claimed.txt',
			'unrelated.txt',
		]);
		writeFileSync(join(directory, 'claimed.txt'), 'original\n');
		const reverted = capture_git_workspace(state);
		expect(Object.keys(reverted.files)).toEqual(['unrelated.txt']);
	});
	it('keeps extension intake and API routing equivalent, including approvals', () => {
		const input = {
			task: 'Implement export feature',
			cwd: '/repo',
			affected_paths: ['src/export'],
			acceptance_criteria: ['exports CSV'],
			constraints: ['no API break'],
			requested_outcome: 'A validated export',
			requested_side_effects: ['commit', 'push'] as const,
			urgency: 'urgent' as const,
			hints: { workflow: 'feature' as const, risk: 'high' as const },
		};
		const from_extension = dispatch_task(
			factory_intake_from_extension({
				...input,
				requested_side_effects: [...input.requested_side_effects],
			}),
			policy,
		);
		const from_api = dispatch_task(
			{
				...input,
				requested_side_effects: [...input.requested_side_effects],
			},
			policy,
		);
		expect(from_extension.workflow.approvals).toEqual(
			from_api.workflow.approvals,
		);
		expect(from_extension.workflow.risk).toBe('high');
		expect(from_extension.contract).toEqual(from_api.contract);
		expect(from_extension.workflow.stall_timeout_ms).toBe(300_000);
		expect(from_extension.rationale).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Risk strengthened'),
				expect.stringContaining('Urgent intake'),
			]),
		);
		expect(from_extension.requested_side_effects).toEqual([
			'commit',
			'push',
		]);
		expect(resolve_factory_owner(undefined, 'current-session')).toBe(
			'current-session',
		);
		expect(resolve_factory_owner('explicit', 'current-session')).toBe(
			'explicit',
		);
	});
	it('applies strengthening-only risk hints and explicit urgency semantics', () => {
		const strengthened = dispatch_task(
			{
				task: 'Upgrade dependency',
				cwd: '/repo',
				urgency: 'urgent',
				hints: { risk: 'critical' },
			},
			policy,
		);
		expect(strengthened.workflow.risk).toBe('critical');
		expect(strengthened.workflow.stall_timeout_ms).toBe(300_000);
		expect(strengthened.workflow.approvals).toContain(
			'public-contract',
		);
		expect(strengthened.rationale).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Risk strengthened'),
				expect.stringContaining('Urgent intake'),
			]),
		);
		const protected_route = dispatch_task(
			{
				task: 'Production incident',
				cwd: '/repo',
				hints: { risk: 'low' },
			},
			policy,
		);
		expect(protected_route.workflow.risk).toBe('critical');
		expect(protected_route.assumptions).toContain(
			'Ignored risk hint low; intake cannot lower workflow risk critical',
		);
	});
	it('turns requested side effects into mandatory approval nodes', () => {
		const resolved = dispatch_task(
			{
				task: 'Upgrade dependencies',
				cwd: '/repo',
				requested_side_effects: ['commit'],
			},
			policy,
		);
		expect(resolved.workflow.approvals).toContain('commit');
		expect(
			resolved.workflow.nodes.find((node) => node.kind === 'approval')
				?.approval_actions,
		).toContain('commit');
	});
	it('fails closed on unsafe or incompatible policy', () => {
		expect(() =>
			validate_repository_policy({
				schema_version: 2,
				policy_id: 'bad',
			} as never),
		).toThrow('Unsupported');
		expect(() =>
			resolve_workflow_policy('feature', {
				schema_version: 1,
				policy_id: 'bad',
				workflow_overrides: { feature: { risk: 'low' } },
			}),
		).toThrow('cannot lower');
	});
	it('handles recursive policy globs and rejects workspace traversal', () => {
		for (const path of [
			'secrets/key',
			'secrets/a/key',
			'secrets/a/b/key',
		])
			expect(() =>
				dispatch_task(
					{
						task: 'Implement feature',
						cwd: '/repo',
						affected_paths: [path],
					},
					{ ...policy, forbidden_paths: ['secrets/**'] },
				),
			).toThrow('forbids affected path');
		expect(() =>
			dispatch_task(
				{
					task: 'Implement feature',
					cwd: '/repo',
					affected_paths: ['../other/file'],
				},
				policy,
			),
		).toThrow('inside the workspace');
	});
	it('rejects malformed nested repository policy', () => {
		expect(() =>
			validate_repository_policy({
				schema_version: 1,
				policy_id: 'bad',
				required_approvals: ['launch'],
			}),
		).toThrow('invalid action');
		expect(() =>
			validate_repository_policy({
				schema_version: 1,
				policy_id: 'bad',
				validations: [
					{
						id: 'x',
						execution: 'shell',
						source: 'check',
						required: true,
					},
				],
			}),
		).toThrow('is invalid');
		expect(() =>
			validate_repository_policy({
				schema_version: 1,
				policy_id: 'bad',
				surprise: true,
			}),
		).toThrow('unknown');
	});
	it('normalizes workspace paths, rejects forbidden paths, and raises risky paths', () => {
		const safe = dispatch_task(
			{
				task: 'Implement feature',
				cwd: '/repo',
				affected_paths: ['src/a.ts'],
			},
			policy,
		);
		expect(safe.workspace.cwd).toBe('/repo');
		expect(safe.affected_paths).toEqual(['/repo/src/a.ts']);
		expect(() =>
			dispatch_task(
				{
					task: 'Implement feature',
					cwd: '/repo',
					affected_paths: ['secrets/key.ts'],
				},
				{ ...policy, forbidden_paths: ['secrets/**'] },
			),
		).toThrow('forbids affected path');
		const risky = dispatch_task(
			{
				task: 'Implement feature',
				cwd: '/repo',
				affected_paths: ['migrations/1.sql'],
			},
			{ ...policy, risky_paths: ['migrations/**'] },
		);
		expect(risky.workflow.risk).toBe('high');
		expect(risky.workflow.approvals).toContain('public-contract');
	});
	it('does not create an execute node when architecture compute is none', () =>
		expect(
			get_workflow('architecture').nodes.some(
				(node) => node.kind === 'execute',
			),
		).toBe(false));
	it('only strengthens approvals and caps compute/retries', () => {
		const result = resolve_workflow_policy('feature', {
			schema_version: 1,
			policy_id: 'strict',
			max_parallelism: 1,
			required_approvals: ['deploy'],
			workflow_overrides: {
				feature: {
					retry_limit: 1,
					validation_commands: ['pnpm audit'],
				},
			},
		});
		expect(result.approvals).toEqual(
			expect.arrayContaining(['public-contract', 'deploy']),
		);
		expect(
			result.nodes.find((node) => node.id === 'validate')
				?.retry_limit,
		).toBe(1);
		expect(result.validations.at(-1)?.command).toBe('pnpm audit');
	});
});

describe('integrated execution, feedback, review, and approval', () => {
	it('runs successful feature work through unanchored review and explicit approval', () => {
		const state = create_factory_state(route(), 'lead');
		claim_paths(state, 'lead', ['src/account']);
		pass(state, 'plan', 'planner');
		pass(state, 'execute');
		pass(state, 'validate');
		add_evidence(state, {
			kind: 'test',
			summary: 'all passed',
			hash: 'abc',
		});
		const packet = create_review_packet(
			state,
			['exports account'],
			['src/account.ts'],
			['no commit'],
			'diff',
		);
		expect(packet.executor_narrative_revealed).toBe(false);
		expect(packet.acceptance_criteria).toEqual(
			state.contract.acceptance_criteria,
		);
		expect(packet.constraints).toEqual(state.contract.constraints);
		start_node(state, 'review', 'reviewer');
		record_initial_review(state, packet.id, 'approve', [], 'diff');
		expect(packet.executor_narrative_revealed).toBe(true);
		complete_node(state, 'review');
		start_node(state, 'approval', 'human');
		expect(() => complete_node(state, 'approval')).toThrow(
			'Missing explicit human approval',
		);
		record_approval(state, {
			action: 'public-contract',
			actor: 'Scott',
			decision: 'approved',
			scope: 'account API',
			evidence_ids: [],
			authentication: 'embedding-application',
		});
		complete_node(state, 'approval');
		pass(state, 'complete', 'human');
		expect(state.status).toBe('completed');
	});
	it('uses the stored contract for review and metrics across amendment and resume', () => {
		const initial = dispatch_task(
			{
				task: 'Implement account export',
				cwd: '/repo',
				acceptance_criteria: ['exports account'],
				constraints: ['no commit'],
			},
			policy,
		);
		const state = create_factory_state(initial, 'lead');
		const original_hash = state.contract.hash;
		resume_state(state, 'lead');
		expect(state.contract.hash).toBe(original_hash);
		const amended = dispatch_task(
			{
				task: 'Implement account export safely',
				cwd: '/repo',
				acceptance_criteria: ['exports account', 'audits access'],
				constraints: ['no commit'],
			},
			policy,
		);
		amend_contract(state, amended);
		expect(state.contract.version).toBe(2);
		expect(state.contract.task).toBe(
			'Implement account export safely',
		);
		expect(state.contract.hash).not.toBe(original_hash);
		const metric = derive_factory_metrics([state])[0]!;
		expect(metric.contracts[0]).toMatchObject({
			workflow_id: state.workflow_id,
			version: 2,
			task: 'Implement account export safely',
			acceptance_criteria: ['exports account', 'audits access'],
		});
	});
	it('automatically schedules validation correction then reuses completed nodes', () => {
		const state = create_factory_state(route(), 'lead');
		pass(state, 'plan');
		pass(state, 'execute');
		start_node(state, 'validate', 'executor');
		expect(fail_node(state, feedback(state, 'validate'))).toBe(
			'retry',
		);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('succeeded');
		expect(
			state.nodes.find((node) => node.id === 'validate')?.status,
		).toBe('ready');
		start_node(state, 'validate', 'executor');
		for (const gate of state.route.workflow.nodes.find(
			(node) => node.id === 'validate',
		)?.validation_gate_ids ?? [])
			add_evidence(state, {
				kind: `validation-gate:${gate}:pass`,
				summary: `${gate} passed`,
			});
		complete_validated_node(state, 'validate');
		expect(
			state.nodes.find((node) => node.id === 'review')?.status,
		).toBe('ready');
	});
	it('cannot bypass required gates through generic validation completion or unrelated evidence', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		start_node(state, 'validate', 'executor');
		add_evidence(state, {
			kind: 'harness-contract',
			summary: 'not validation',
		});
		expect(() => complete_node(state, 'validate')).toThrow(
			'only complete through',
		);
		state.nodes.find((node) => node.id === 'validate')!.status =
			'succeeded';
		expect(() =>
			create_review_packet(
				state,
				['criterion'],
				['file.ts'],
				[],
				'diff',
			),
		).toThrow('missing required validation evidence');
	});
	it('cannot complete a review node without a current approving verdict', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		pass(state, 'validate');
		start_node(state, 'review', 'reviewer');
		expect(() => complete_node(state, 'review')).toThrow(
			'requires a current review packet',
		);
	});
	it('routes reviewer correction through the same bounded feedback schema', () => {
		const state = create_factory_state(route(), 'lead');
		pass(state, 'plan');
		pass(state, 'execute');
		pass(state, 'validate');
		start_node(state, 'review', 'reviewer');
		const packet = normalize_feedback({
			...feedback(state, 'review'),
			source: 'reviewer',
		});
		expect(fail_node(state, packet)).toBe('retry');
		expect(state.feedback[0]?.source).toBe('reviewer');
	});
	it('does not reopen execution after an escalated review verdict', () => {
		const state = create_factory_state(route(), 'lead');
		pass(state, 'plan');
		pass(state, 'execute');
		pass(state, 'validate');
		start_node(state, 'review', 'reviewer');
		const packet = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff',
		);
		record_initial_review(
			state,
			packet.id,
			'escalate',
			[
				{
					severity: 'critical',
					disposition: 'must-fix',
					code: 'review.unsafe',
					message: 'Unsafe contract conflict',
					evidence_ids: [],
					required_action: 'Require human resolution',
				},
			],
			'diff',
		);
		expect(state.status).toBe('escalated');
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('succeeded');
		expect(() => start_node(state, 'execute', 'executor')).toThrow();
	});
	it('escalates exhausted, contradictory, unsafe, and ownerless failures', () => {
		for (const options of [
			{ contradictory: true },
			{ unsafe_fix: true },
		]) {
			const state = create_factory_state(route());
			pass(state, 'plan');
			pass(state, 'execute');
			start_node(state, 'validate', 'executor');
			expect(
				fail_node(state, feedback(state, 'validate', options)),
			).toBe('escalate');
		}
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		start_node(state, 'validate', 'executor');
		state.nodes.find(
			(node) => node.id === 'validate',
		)!.owner_session_id = undefined;
		expect(fail_node(state, feedback(state, 'validate'))).toBe(
			'escalate',
		);
	});
	it('rejects missing review evidence, stale diffs, and changed contracts', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		pass(state, 'validate');
		state.evidence = [];
		expect(() =>
			create_review_packet(
				state,
				['criterion'],
				['file.ts'],
				[],
				'diff',
			),
		).toThrow('missing required validation evidence');
		for (const gate of state.route.workflow.nodes.find(
			(node) => node.id === 'validate',
		)?.validation_gate_ids ?? [])
			add_evidence(state, {
				kind: `validation-gate:${gate}:pass`,
				summary: `${gate} passed`,
			});
		const packet = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff',
		);
		expect(() =>
			record_initial_review(
				state,
				packet.id,
				'approve',
				[],
				'changed',
			),
		).toThrow('diff is stale');
		record_initial_review(state, packet.id, 'approve', [], 'diff');
		record_approval(state, {
			action: 'public-contract',
			actor: 'Scott',
			decision: 'approved',
			scope: 'API',
			evidence_ids: [],
			authentication: 'embedding-application',
		});
		expect(requires_approval(state, 'public-contract')).toBe(false);
		const stale_packet = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff',
		);
		const current = route('Implement revised feature');
		amend_contract(state, current);
		expect(requires_approval(state, 'public-contract')).toBe(true);
		expect(() =>
			record_initial_review(
				state,
				stale_packet.id,
				'approve',
				[],
				'diff',
			),
		).toThrow('contract is stale');
	});
	it('uses only the latest review and exact diff as approval authority', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		pass(state, 'validate');
		add_evidence(state, { kind: 'test', summary: 'pass' });
		start_node(state, 'review', 'reviewer');
		const approved = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff-a',
		);
		record_initial_review(
			state,
			approved.id,
			'approve',
			[],
			'diff-a',
		);
		record_approval(state, {
			action: 'public-contract',
			actor: 'Scott',
			decision: 'approved',
			scope: 'API',
			evidence_ids: [],
			authentication: 'embedding-application',
		});
		expect(requires_approval(state, 'public-contract')).toBe(false);
		const changed = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff-b',
		);
		expect(requires_approval(state, 'public-contract')).toBe(true);
		const packet = record_initial_review(
			state,
			changed.id,
			'changes-requested',
			[
				{
					severity: 'error',
					disposition: 'must-fix',
					code: 'review.fix',
					message: 'Fix it',
					evidence_ids: [],
					required_action: 'Change implementation',
				},
			],
			'diff-b',
		);
		expect(packet?.source).toBe('reviewer');
		expect(packet?.owner_session_id).toBe('executor');
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('ready');
		expect(
			state.nodes.find((node) => node.id === 'validate')?.status,
		).toBe('pending');
		expect(
			state.nodes.find((node) => node.id === 'review')?.status,
		).toBe('pending');
		expect(
			state.evidence.some((item) =>
				item.kind.startsWith('validation'),
			),
		).toBe(false);
		expect(() =>
			record_approval(state, {
				action: 'public-contract',
				actor: 'Scott',
				decision: 'approved',
				scope: 'API',
				evidence_ids: [],
				authentication: 'embedding-application',
			}),
		).toThrow('latest review');
		pass(state, 'execute');
		pass(state, 'validate');
		start_node(state, 'review', 'reviewer');
		const corrected = create_review_packet(
			state,
			['criterion'],
			['file.ts'],
			[],
			'diff-c',
		);
		record_initial_review(
			state,
			corrected.id,
			'approve',
			[],
			'diff-c',
		);
		complete_node(state, 'review');
		expect(
			state.nodes.find((node) => node.id === 'approval')?.status,
		).toBe('ready');
	});
	it('records refusal without inferring approval and releases ownership', () => {
		const state = create_factory_state(route());
		claim_paths(state, 'owner', state.route.affected_paths);
		record_approval(state, {
			action: 'public-contract',
			actor: 'Scott',
			decision: 'refused',
			scope: 'API',
			evidence_ids: [],
			authentication: 'embedding-application',
		});
		expect(state.status).toBe('cancelled');
		expect(
			state.claims.every((claim) => claim.status === 'released'),
		).toBe(true);
	});
});

describe('closed-loop validation', () => {
	it('executes shell gates and completes validation with evidence', async () => {
		const resolved = route();
		resolved.workspace.cwd = mkdtempSync(
			join(tmpdir(), 'factory-run-'),
		);
		resolved.workflow.validations = [
			{
				id: 'test',
				execution: 'shell',
				command: `node -e "process.exit(0)"`,
				source: 'test',
				required: true,
			},
		];
		resolved.workflow.nodes.find(
			(node) => node.id === 'validate',
		)!.validation_gate_ids = ['test'];
		const state = create_factory_state(resolved);
		pass(state, 'plan');
		pass(state, 'execute');
		start_node(state, 'validate', 'executor');
		expect(await run_validation_node(state)).toBe('passed');
		expect(
			state.evidence.some((item) => item.kind === 'validation:test'),
		).toBe(true);
	});
	it('normalizes failure, schedules bounded retry, and routes to the owner adapter', async () => {
		const resolved = route();
		resolved.workspace.cwd = mkdtempSync(
			join(tmpdir(), 'factory-run-'),
		);
		resolved.workflow.validations = [
			{
				id: 'test',
				execution: 'shell',
				command: `node -e "process.exit(1)"`,
				source: 'test',
				required: true,
			},
		];
		resolved.workflow.nodes.find(
			(node) => node.id === 'validate',
		)!.validation_gate_ids = ['test'];
		const state = create_factory_state(resolved);
		pass(state, 'plan');
		pass(state, 'execute');
		start_node(state, 'validate', 'executor-session');
		const routed: string[] = [];
		expect(
			await run_validation_node(state, {
				route_feedback: async (owner, packet) => {
					routed.push(owner, packet.id);
				},
			}),
		).toBe('retry');
		expect(routed[0]).toBe('executor-session');
		expect(state.feedback).toHaveLength(1);
	});
});

describe('durable feedback outbox', () => {
	it('retains a failed delivery and retries idempotently by packet id', async () => {
		const packet = normalize_feedback({
			workflow_id: 'workflow',
			node_id: 'validate',
			attempt: 1,
			source: 'test',
			owner_session_id: 'owner',
			contradictory: false,
			unsafe_fix: false,
			items: [
				{
					severity: 'error',
					code: 'x',
					message: 'failed',
					evidence_ids: [],
					required_action: 'fix',
				},
			],
		});
		await deliver_feedback_packet(packet, async () => {
			throw new Error('offline');
		});
		expect(packet.delivery.status).toBe('failed');
		expect(packet.delivery.attempts).toBe(1);
		await deliver_feedback_packet(
			packet,
			async (same) => `message:${same.id}`,
		);
		expect(packet.delivery.status).toBe('delivered');
		expect(packet.delivery.attempts).toBe(2);
		expect(packet.delivery.message_id).toBe(`message:${packet.id}`);
		await deliver_feedback_packet(packet, async () => 'duplicate');
		expect(packet.delivery.attempts).toBe(2);
	});
});

describe('ownership, interruption, resume, and metrics', () => {
	it('prevents same-workspace partial overlap without colliding across repositories', () => {
		const first = create_factory_state(route());
		const claim = claim_paths(first, 'one', ['/repo/src/account']);
		const second = create_factory_state(
			route('Implement another feature'),
		);
		expect(() =>
			claim_paths(
				second,
				'two',
				['/repo/src/account/forms'],
				[claim],
			),
		).toThrow('Path overlap');
		const other = create_factory_state(
			dispatch_task(
				{
					task: 'Implement feature',
					cwd: '/other',
					affected_paths: ['src/account'],
				},
				policy,
			),
		);
		expect(() =>
			claim_paths(other, 'two', ['/other/src/account'], [claim]),
		).not.toThrow();
	});
	it('surfaces stalls without claiming supervision and resumes the active node', () => {
		const state = create_factory_state(route(), 'lead');
		claim_paths(state, 'lead', ['src']);
		start_node(state, 'plan', 'lead');
		state.claims[0]!.heartbeat_at = '2000-01-01T00:00:00.000Z';
		expect(detect_stall(state)).toBe(true);
		expect(state.nodes[0]?.blocked_reason).toContain(
			'supervision is unavailable',
		);
		resume_state(state, 'replacement');
		expect(state.nodes[0]?.status).toBe('ready');
	});
	it('reconciles node ids and approval topology when workflow kind changes', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		const architecture = dispatch_task(
			{
				task: 'Research architecture',
				cwd: '/repo',
				affected_paths: ['docs'],
			},
			policy,
		);
		amend_contract(state, architecture);
		expect(state.nodes.some((node) => node.kind === 'execute')).toBe(
			false,
		);
		expect(state.nodes.map((node) => node.id)).toEqual(
			architecture.workflow.nodes.map((node) => node.id),
		);
		const chore = dispatch_task(
			{
				task: 'Upgrade dependency',
				cwd: '/repo',
				affected_paths: ['package.json'],
				requested_side_effects: ['commit'],
			},
			policy,
		);
		amend_contract(state, chore);
		expect(
			state.nodes.find((node) => node.kind === 'approval'),
		).toBeDefined();
		expect(state.nodes.map((node) => node.id)).toEqual(
			chore.workflow.nodes.map((node) => node.id),
		);
	});
	it('persists authoritative state atomically and invalidates downstream nodes after amendment', () => {
		const state = create_factory_state(route());
		pass(state, 'plan');
		pass(state, 'execute');
		const amended = route('Implement revised feature');
		amend_contract(state, amended);
		expect(state.contract_version).toBe(2);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('ready');
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('pending');
		resume_state(state, 'executor');
		pass(state, 'plan');
		pass(state, 'execute');
		expect(
			state.nodes.find((node) => node.id === 'validate')?.status,
		).toBe('ready');
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-')),
		);
		store.save(state);
		expect(store.load(state.workflow_id).contract_version).toBe(2);
	});
	it('backfills legacy schema-v1 state without inventing a task contract', () => {
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-legacy-')),
		);
		const state = create_factory_state(route());
		store.save(state);
		const legacy = structuredClone(state) as unknown as Record<
			string,
			unknown
		>;
		delete legacy.contract;
		const legacy_route = legacy.route as Record<string, unknown>;
		delete legacy_route.contract;
		delete legacy_route.work_type;
		delete legacy_route.complexity;
		writeFileSync(
			store.path(state.workflow_id),
			JSON.stringify(legacy),
		);
		const loaded = store.load(state.workflow_id);
		expect(loaded.contract).toEqual({
			version: 1,
			task: '',
			acceptance_criteria: [],
			constraints: [],
			requested_outcome: '',
			hash: '',
			status: 'legacy-missing',
		});
		expect(loaded.route.work_type).toBe(loaded.route.workflow.id);
		expect(loaded.route.complexity.evidence).toContain(
			'legacy state: complexity unavailable',
		);
	});
	it('fails closed on unsupported or malformed persisted state', () => {
		const directory = mkdtempSync(join(tmpdir(), 'factory-schema-'));
		const store = new FactoryStateStore(directory);
		const future = '00000000-0000-4000-8000-000000000001';
		const invalid = '00000000-0000-4000-8000-000000000002';
		writeFileSync(
			store.path(future),
			JSON.stringify({ schema_version: 2 }),
		);
		expect(() => store.load(future)).toThrow('Unsupported');
		writeFileSync(
			store.path(invalid),
			JSON.stringify({ schema_version: 1, revision: 1, nodes: [] }),
		);
		expect(() => store.load(invalid)).toThrow('Invalid');
		expect(() => store.path('../../outside')).toThrow('UUID');
	});
	it('ignores auxiliary JSON files in the workflow state directory', () => {
		const directory = mkdtempSync(
			join(tmpdir(), 'factory-auxiliary-'),
		);
		const store = new FactoryStateStore(directory);
		const state = create_factory_state(route());
		store.save(state);
		writeFileSync(
			join(directory, 'intake-ledger.json'),
			JSON.stringify({ schema_version: 1, entries: {} }),
		);
		expect(store.list().map((item) => item.workflow_id)).toEqual([
			state.workflow_id,
		]);
	});
	it('rejects malformed nested persisted authority', () => {
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-nested-')),
		);
		const state = create_factory_state(route());
		store.save(state);
		const corrupt = store.load(state.workflow_id);
		corrupt.approvals.push({
			action: 'launch' as never,
			actor: 'x',
			decision: 'approved',
			scope: 'x',
			evidence_ids: [],
			contract_version: 1,
			diff_hash: 'x',
			authentication: 'embedding-application',
			decided_at: new Date().toISOString(),
		});
		writeFileSync(
			store.path(state.workflow_id),
			JSON.stringify(corrupt),
		);
		expect(() => store.load(state.workflow_id)).toThrow('approvals');
	});
	it('rejects a tampered authoritative contract hash', () => {
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-contract-hash-')),
		);
		const state = create_factory_state(route());
		store.save(state);
		state.contract.task = 'tampered task';
		writeFileSync(
			store.path(state.workflow_id),
			JSON.stringify(state),
		);
		expect(() => store.load(state.workflow_id)).toThrow(
			'Invalid factory state identity or route',
		);
	});
	it('rejects stale concurrent writers with revision compare-and-swap', () => {
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-cas-')),
		);
		const state = create_factory_state(route());
		store.save(state);
		const left = store.load(state.workflow_id);
		const right = store.load(state.workflow_id);
		left.status = 'paused';
		store.save(left);
		right.status = 'cancelled';
		expect(() => store.save(right)).toThrow('state conflict');
	});
	it('correlates existing compute evidence and derives versioned metrics', () => {
		const state = create_factory_state(route());
		state.status = 'completed';
		state.updated_at = new Date(
			Date.parse(state.created_at) + 100,
		).toISOString();
		state.events.push({
			id: 'approval',
			workflow_id: state.workflow_id,
			workflow_version: state.route.workflow.version,
			type: 'approval.granted',
			timestamp: new Date().toISOString(),
			duration_ms: 42,
		});
		correlate_compute(state, {
			node_id: 'execute',
			role: 'executor',
			telemetry_run_id: 'run-1',
			observability_session_id: 'session-1',
			tokens: 100,
			cost_usd: 0.2,
		});
		const metrics = derive_factory_metrics([state])[0]!;
		expect(metrics.workflow).toBe('feature');
		expect(metrics.tokens).toBe(100);
		expect(metrics.cost_usd).toBe(0.2);
		expect(metrics.first_pass_success_rate).toBe(1);
		expect(metrics.approval_wait_ms).toBe(42);
	});
});
