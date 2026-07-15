import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatch_task } from './dispatch.js';
import {
	claim_paths,
	complete_node,
	create_factory_state,
	start_node,
} from './engine.js';
import {
	create_rpc_execution_adapter,
	create_sdk_execution_adapter,
	ExecutionController,
	ExecutionRegistry,
	peer_execution_adapter,
	WorkflowOperator,
} from './execution.js';
import type { RepositoryPolicy } from './types.js';

const policy: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'test',
	required_approvals: [],
};
function setup() {
	const route = dispatch_task(
		{
			task: 'Implement export feature',
			cwd: '/repo',
			affected_paths: ['src/**'],
		},
		policy,
	);
	const state = create_factory_state(route, 'owner');
	claim_paths(state, 'owner', ['src/**']);
	const registry = new ExecutionRegistry(
		join(mkdtempSync(join(tmpdir(), 'execution-')), 'registry.json'),
	);
	return {
		state,
		registry,
		controller: new ExecutionController(registry),
	};
}

describe('workflow execution adapters', () => {
	it('initiates and progresses an SDK-owned node idempotently', async () => {
		const { state, registry, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
					artifact_ids: ['plan-artifact'],
				};
			},
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		expect(record.lifecycle).toBe('succeeded');
		controller.apply_result(state, record);
		controller.apply_result(state, record);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('succeeded');
		expect(
			registry.get(record.request.execution_id)?.result?.artifact_ids,
		).toEqual(['plan-artifact']);
	});

	it('persists intent before provider failure and routes structured feedback', async () => {
		const { state, registry, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run() {
				throw new Error('provider unavailable');
			},
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		expect(record.lifecycle).toBe('failed');
		expect(
			registry.find_by_key(record.request.idempotency_key),
		).toBeDefined();
		const packet = controller.apply_result(state, record);
		expect(packet?.items[0]?.code).toBe('execution.provider');
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('escalated');
	});

	it('rejects stale callbacks and competing mutating owners', async () => {
		const { state, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'running',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
		});
		await expect(
			controller.initiate(state, 'plan', adapter, {
				owner_session_id: 'other',
				task: 'Plan',
				cwd: '/repo',
			}),
		).rejects.toThrow('mutating owner');
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		state.contract_version += 1;
		expect(() =>
			controller.apply_result(state, {
				...record,
				lifecycle: 'succeeded',
			}),
		).toThrow('Stale');
	});

	it('owns and observes a Pi JSONL RPC subprocess without shell execution', async () => {
		const { state, controller } = setup();
		const adapter = create_rpc_execution_adapter({
			command: process.execPath,
			args: [
				'-e',
				`process.stdin.on('data', chunk => { for (const line of String(chunk).trim().split('\\n')) { const command = JSON.parse(line); console.log(JSON.stringify({ id: command.id, type: 'response', command: 'prompt', success: true })); console.log(JSON.stringify({ type: 'agent_settled' })); } });`,
			],
			cwd: process.cwd(),
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		expect(record.lifecycle).toBe('running');
		let result = await adapter.poll!(record.request.execution_id);
		for (
			let attempt = 0;
			attempt < 40 && result.lifecycle === 'running';
			attempt += 1
		) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			result = await adapter.poll!(record.request.execution_id);
		}
		expect(result.lifecycle).toBe('succeeded');
	});

	it('progresses a direct chore through owned execution and real validation gates', async () => {
		const route = dispatch_task(
			{
				task: 'Update a bounded dependency',
				cwd: process.cwd(),
				affected_paths: ['package.json'],
			},
			policy,
			{ workflow: 'chore', reason: 'Deterministic maintenance' },
		);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', ['package.json']);
		const registry = new ExecutionRegistry(
			join(
				mkdtempSync(join(tmpdir(), 'execution-')),
				'registry.json',
			),
		);
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
		});
		for (const gate of state.route.workflow.validations)
			if (gate.execution === 'shell')
				gate.command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
		const operator = new WorkflowOperator(
			new ExecutionController(registry),
			{ execute: adapter },
			() => {},
			{
				async run_tool_gate() {
					return { success: true, summary: 'tool gate passed' };
				},
			},
		);
		const records = await operator.progress(state, {
			owner_session_id: 'owner',
			task: 'Update a bounded dependency',
			cwd: process.cwd(),
		});
		expect(records.map((record) => record.request.node_id)).toEqual([
			'execute',
		]);
		expect(
			state.nodes.find((node) => node.id === 'validate')?.status,
		).toBe('succeeded');
		start_node(state, 'complete', 'human');
		complete_node(state, 'complete');
		expect(state.status).toBe('completed');
		expect(state.reviews).toEqual([]);
		expect(state.approvals).toEqual([]);
	});

	it('progresses planner, executor, and validation nodes without manual relay', async () => {
		const { state, registry, controller } = setup();
		state.route.workspace.cwd = process.cwd();
		for (const gate of state.route.workflow.validations)
			if (gate.execution === 'shell')
				gate.command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
		});
		let persisted = 0;
		const operator = new WorkflowOperator(
			controller,
			{ plan: adapter, execute: adapter },
			() => {
				persisted += 1;
			},
			{
				async run_tool_gate() {
					return { success: true, summary: 'tool gate passed' };
				},
			},
		);
		const records = await operator.progress(state, {
			owner_session_id: 'owner',
			task: 'Implement',
			cwd: '/repo',
		});
		expect(records.map((record) => record.request.node_id)).toEqual([
			'plan',
			'execute',
		]);
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('succeeded');
		expect(
			state.nodes.find((node) => node.id === 'validate')?.status,
		).toBe('succeeded');
		expect(registry.list_pending()).toEqual([]);
		expect(persisted).toBeGreaterThanOrEqual(4);
	});

	it('recovers a persisted SDK intent after workflow-state loss', async () => {
		const { state, registry, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'running',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
			async recover(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
		});
		await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		const recovered = create_factory_state(state.route, 'owner');
		claim_paths(recovered, 'owner', recovered.route.affected_paths);
		const operator = new WorkflowOperator(
			new ExecutionController(registry),
			{ plan: adapter },
			() => {},
		);
		await operator.progress(recovered, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		expect(
			recovered.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('succeeded');
	});

	it('represents peer mailbox operation as operator-required, never supervised', async () => {
		const { state, controller } = setup();
		const record = await controller.initiate(
			state,
			'plan',
			peer_execution_adapter,
			{
				owner_session_id: 'peer',
				task: 'Plan',
				cwd: '/repo',
				read_only: true,
			},
		);
		expect(record.lifecycle).toBe('operator-required');
		expect(
			peer_execution_adapter.capabilities.supervises_process,
		).toBe(false);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('ready');
	});

	it('keeps approval and authoritative validation completion outside adapters', async () => {
		const { state, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'sdk',
					adapter_version: '1',
				};
			},
		});
		await expect(
			controller.initiate(state, 'validate', adapter, {
				owner_session_id: 'owner',
				task: 'Validate',
				cwd: '/repo',
			}),
		).rejects.toThrow('authoritative factory operation');
	});

	it('runs validation and independent structured review up to human approval', async () => {
		const { state, controller } = setup();
		state.route.workspace.cwd = process.cwd();
		for (const gate of state.route.workflow.validations)
			if (gate.execution === 'shell')
				gate.command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					execution_id: request.execution_id,
					lifecycle: 'succeeded',
					adapter_id: 'sdk',
					adapter_version: '1',
					...(request.review_packet
						? {
								review: {
									review_id: request.review_packet.id,
									verdict: 'approve' as const,
									findings: [],
									current_diff: 'diff',
								},
							}
						: {}),
				};
			},
		});
		const operator = new WorkflowOperator(
			controller,
			{ plan: adapter, execute: adapter, review: adapter },
			() => {},
			{
				async run_tool_gate() {
					return { success: true, summary: 'tool gate passed' };
				},
			},
		);
		await operator.progress(state, {
			owner_session_id: 'owner',
			task: 'Implement and review',
			cwd: process.cwd(),
			review: {
				acceptance_criteria: ['works'],
				changed_files: ['src/file.ts'],
				constraints: [],
				diff: 'diff',
			},
		});
		expect(
			state.nodes.find((node) => node.kind === 'review')?.status,
		).toBe('succeeded');
		expect(
			state.nodes.find((node) => node.kind === 'approval')?.status,
		).toBe('ready');
	});
});
