import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatch_task } from './dispatch.js';
import {
	claim_paths,
	complete_node,
	create_factory_state,
	FactoryStateStore,
	start_node,
} from './engine.js';
import {
	create_rpc_execution_adapter,
	create_sdk_execution_adapter,
	ExecutionController,
	ExecutionRegistry,
	peer_execution_adapter,
	WorkflowOperator,
	type ExecutionRequest,
	type ExecutionResult,
} from './execution.js';
import {
	capture_git_workspace,
	reconcile_factory_status,
} from './extension.js';
import type { RepositoryPolicy } from './types.js';

const policy: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'test',
	required_approvals: [],
};
function snapshot(files: Record<string, string> = {}) {
	return { head: 'test-head', files };
}
function successful_result(
	request: ExecutionRequest,
	changed_files = request.node_id === 'execute'
		? ['src/export.ts']
		: [],
): ExecutionResult {
	const evidence_id = 'result-evidence';
	return {
		execution_id: request.execution_id,
		lifecycle: 'settled',
		adapter_id: 'pi-sdk',
		adapter_version: '1',
		protocol_version: 1,
		contract_version: request.contract_version,
		outcome: 'completed',
		changed_files,
		evidence: [
			{
				id: evidence_id,
				kind: 'execution:test',
				summary: 'completed',
			},
		],
		acceptance_results: request.contract.acceptance_criteria.map(
			(criterion) => ({
				criterion,
				status: 'met',
				evidence_ids: [evidence_id],
			}),
		),
	};
}
function setup() {
	const route = dispatch_task(
		{
			task: 'Implement export feature',
			cwd: process.cwd(),
			affected_paths: ['src/**'],
		},
		policy,
	);
	const state = create_factory_state(route, 'owner');
	claim_paths(state, 'owner', ['src/**']);
	const registry = new ExecutionRegistry(
		join(mkdtempSync(join(tmpdir(), 'execution-')), 'registry.json'),
	);
	let capture_calls = 0;
	return {
		state,
		registry,
		controller: new ExecutionController(registry, () =>
			snapshot(
				capture_calls++ % 2 === 0
					? {}
					: { 'src/export.ts': 'changed' },
			),
		),
	};
}

describe('workflow execution adapters', () => {
	it('initiates and progresses an SDK-owned node idempotently', async () => {
		const { state, registry, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					...successful_result(request),
					artifact_ids: ['plan-artifact'],
				};
			},
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			task: 'Plan',
			cwd: '/repo',
		});
		expect(record.lifecycle).toBe('settled');
		expect(record.request.task).toBe('Implement export feature');
		expect(record.request.contract).toEqual(state.contract);
		expect(record.request.role_policy).toEqual(
			state.route.workflow.compute.planner,
		);
		controller.apply_result(state, record);
		controller.apply_result(state, record);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('succeeded');
		expect(
			registry.get(record.request.execution_id)?.result?.artifact_ids,
		).toEqual(['plan-artifact']);
		const canonical_evidence = state.evidence.find(
			(item) => item.source_id === 'result-evidence',
		)!;
		expect(state.acceptance_evaluations[0]).toMatchObject({
			execution_id: record.request.execution_id,
			criterion: state.contract.acceptance_criteria[0],
			evidence_ids: [canonical_evidence.id],
		});
		const state_store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-evidence-')),
		);
		state_store.save(state);
		const persisted = state_store.load(state.workflow_id);
		expect(persisted.evidence[0]?.source_id).toBe('result-evidence');
		expect(persisted.acceptance_evaluations[0]?.evidence_ids).toEqual(
			[persisted.evidence[0]?.id],
		);
	});

	it('blocks legacy state until an authoritative contract amendment', async () => {
		const { state, controller } = setup();
		state.contract = {
			version: 1,
			task: '',
			acceptance_criteria: [],
			constraints: [],
			requested_outcome: '',
			hash: '',
			status: 'legacy-missing',
		};
		await expect(
			controller.initiate(
				state,
				'plan',
				create_sdk_execution_adapter({
					async run(request) {
						return {
							execution_id: request.execution_id,
							lifecycle: 'succeeded',
							adapter_id: 'pi-sdk',
							adapter_version: '1',
						};
					},
				}),
				{ owner_session_id: 'owner', cwd: '/repo' },
			),
		).rejects.toThrow('amend it before execution');
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

	it('treats agent settlement without a structured result as incomplete', async () => {
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
		expect(result.lifecycle).toBe('settled');
		const settled = controller.poll(record, adapter);
		await expect(settled).resolves.toBeDefined();
		const refreshed = await settled;
		const packet = controller.apply_result(state, refreshed);
		expect(packet?.items[0]?.code).toBe(
			'execution.invalid-structured-result',
		);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).not.toBe('succeeded');
	});

	it('accepts truthful structured RPC success under least-authority child environment', async () => {
		const { state, controller } = setup();
		const payload = JSON.stringify({
			protocol_version: 1,
			contract_version: 1,
			outcome: 'completed',
			changed_files: [],
			evidence: [
				{
					id: 'rpc-evidence',
					kind: 'execution:rpc',
					summary: 'plan completed',
				},
			],
			acceptance_results: state.contract.acceptance_criteria.map(
				(criterion) => ({
					criterion,
					status: 'met',
					evidence_ids: ['rpc-evidence'],
				}),
			),
		});
		const adapter = create_rpc_execution_adapter({
			command: process.execPath,
			args: [
				'-e',
				`if (process.env.PI_FACTORY_CONTROL_PLANE !== 'read-only' || process.env.PI_FACTORY_CHILD_ROLE !== 'planner') process.exit(8); const payload = ${JSON.stringify(payload)}; process.stdin.on('data', chunk => { for (const line of String(chunk).trim().split('\\n')) { const command = JSON.parse(line); console.log(JSON.stringify({ id: command.id, type: 'response', command: 'prompt', success: true })); console.log(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: payload } })); console.log(JSON.stringify({ type: 'agent_settled' })); } });`,
			],
			cwd: process.cwd(),
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		let refreshed = await controller.poll(record, adapter);
		for (
			let attempt = 0;
			attempt < 40 && refreshed.lifecycle === 'running';
			attempt += 1
		) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			refreshed = await controller.poll(refreshed, adapter);
		}
		expect(refreshed.lifecycle).toBe('settled');
		expect(refreshed.result?.outcome).toBe('completed');
		controller.apply_result(state, refreshed);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('succeeded');
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
				return successful_result(request, ['package.json']);
			},
		});
		for (const gate of state.route.workflow.validations)
			if (gate.execution === 'shell')
				gate.command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
		let capture_calls = 0;
		const operator = new WorkflowOperator(
			new ExecutionController(registry, () =>
				snapshot(
					capture_calls++ % 2 === 0
						? {}
						: { 'package.json': 'changed' },
				),
			),
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

	it('passes enforced model and reasoning configuration to the RPC process', async () => {
		const route = dispatch_task(
			{ task: 'Implement configured feature', cwd: '/repo' },
			policy,
			{
				workflow: 'feature',
				reason: 'Pin execution model',
				model_overrides: { planner: 'provider/model' },
			},
		);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', ['src/**']);
		const registry = new ExecutionRegistry(
			join(
				mkdtempSync(join(tmpdir(), 'execution-')),
				'registry.json',
			),
		);
		const controller = new ExecutionController(registry);
		const adapter = create_rpc_execution_adapter({
			command: process.execPath,
			args: [
				'-e',
				`if (!process.argv.includes('provider/model') || !process.argv.includes('high')) process.exit(9); process.stdin.on('data', chunk => { for (const line of String(chunk).trim().split('\\n')) { const command = JSON.parse(line); console.log(JSON.stringify({ id: command.id, type: 'response', command: 'prompt', success: true })); console.log(JSON.stringify({ type: 'agent_settled' })); } });`,
				'--',
			],
			cwd: process.cwd(),
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		expect(record.request.role_policy).toMatchObject({
			model: 'provider/model',
			thinking: 'high',
			enforcement: 'enforced',
		});
		let result = await adapter.poll!(record.request.execution_id);
		for (
			let attempt = 0;
			attempt < 40 && result.lifecycle === 'running';
			attempt += 1
		) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			result = await adapter.poll!(record.request.execution_id);
		}
		expect(result.lifecycle).toBe('settled');
		expect(result.effective_policy).toEqual(
			record.request.role_policy,
		);
	});

	it('rejects an SDK result that does not confirm enforced compute', async () => {
		const route = dispatch_task(
			{ task: 'Implement configured SDK feature', cwd: '/repo' },
			policy,
			{
				workflow: 'feature',
				reason: 'Pin SDK model',
				model_overrides: { planner: 'provider/model' },
			},
		);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', ['src/**']);
		const controller = new ExecutionController(
			new ExecutionRegistry(
				join(
					mkdtempSync(join(tmpdir(), 'execution-')),
					'registry.json',
				),
			),
		);
		const record = await controller.initiate(
			state,
			'plan',
			create_sdk_execution_adapter({
				async run(request) {
					return {
						execution_id: request.execution_id,
						lifecycle: 'succeeded',
						adapter_id: 'pi-sdk',
						adapter_version: '1',
					};
				},
			}),
			{ owner_session_id: 'owner', cwd: '/repo' },
		);
		expect(record.lifecycle).toBe('failed');
		expect(record.result?.failure?.message).toContain(
			'did not confirm the enforced model',
		);
	});

	it('progresses planner, executor, and validation nodes without manual relay', async () => {
		const { state, registry, controller } = setup();
		state.route.workspace.cwd = process.cwd();
		for (const gate of state.route.workflow.validations)
			if (gate.execution === 'shell')
				gate.command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return successful_result(request);
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
				return successful_result(request);
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

	it('marks owned execution lost immediately when its adapter disappears after reload', async () => {
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
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		const operator = new WorkflowOperator(
			new ExecutionController(registry),
			{},
			() => {},
		);
		await operator.progress(state, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		expect(registry.get(record.request.execution_id)?.lifecycle).toBe(
			'lost',
		);
		expect(registry.list_pending()).toEqual([]);
		expect(state.status).not.toBe('running');
	});

	it('reconciles persisted orphaned execution before status reports after TUI reload', async () => {
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
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		const store = new FactoryStateStore(
			mkdtempSync(join(tmpdir(), 'factory-status-reload-')),
		);
		store.save(state);
		const reloaded = store.load(state.workflow_id);
		const summary = await reconcile_factory_status(
			reloaded,
			new ExecutionController(registry),
			undefined,
			(current) => store.save(current),
		);
		expect(summary.active_process_session).toBeUndefined();
		expect(summary.status).not.toBe('running');
		expect(registry.get(record.request.execution_id)?.lifecycle).toBe(
			'lost',
		);
		expect(store.load(state.workflow_id).status).not.toBe('running');
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
		expect(record.request.task).toBe(state.contract.task);
		expect(record.request.contract.hash).toBe(state.contract.hash);
		expect(
			peer_execution_adapter.capabilities.supervises_process,
		).toBe(false);
		expect(
			state.nodes.find((node) => node.id === 'plan')?.status,
		).toBe('ready');
	});

	it('rejects malformed result evidence before canonical mutation', async () => {
		const { state, controller } = setup();
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				return {
					...successful_result(request),
					evidence: [
						{
							id: 'malformed',
							kind: 'execution:test',
							summary: 42 as unknown as string,
						},
					],
				};
			},
		});
		const record = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		const packet = controller.apply_result(state, record);
		expect(packet?.items[0]?.code).toBe(
			'execution.invalid-structured-result',
		);
		expect(state.evidence).toEqual([]);
		expect(state.acceptance_evaluations).toEqual([]);
	});

	it('rejects omitted and out-of-scope changes against a complete workspace delta', async () => {
		const directory = mkdtempSync(
			join(tmpdir(), 'factory-authority-'),
		);
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
		writeFileSync(
			join(directory, 'claimed.ts'),
			'export const value = 1;\n',
		);
		writeFileSync(join(directory, 'config.json'), '{}\n');
		writeFileSync(
			join(directory, 'omitted.ts'),
			'export const other = 1;\n',
		);
		execFileSync('git', ['add', '.'], { cwd: directory });
		execFileSync('git', ['commit', '-qm', 'fixture'], {
			cwd: directory,
		});
		const route = dispatch_task(
			{
				task: 'Update dependency TypeScript files',
				cwd: directory,
				affected_paths: ['**/*.ts'],
				acceptance_criteria: ['implementation is updated'],
			},
			policy,
			{ workflow: 'chore', reason: 'Authority fixture' },
		);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', route.affected_paths);
		const controller = new ExecutionController(
			new ExecutionRegistry(
				join(
					mkdtempSync(join(tmpdir(), 'execution-')),
					'registry.json',
				),
			),
			capture_git_workspace,
		);
		let execution_attempt = 0;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				execution_attempt += 1;
				if (execution_attempt === 1) {
					writeFileSync(
						join(directory, 'claimed.ts'),
						'export const value = 2;\n',
					);
					writeFileSync(
						join(directory, 'config.json'),
						'{"unsafe":true}\n',
					);
				} else
					writeFileSync(
						join(directory, 'omitted.ts'),
						'export const other = 2;\n',
					);
				return successful_result(request, ['claimed.ts']);
			},
		});
		const record = await controller.initiate(
			state,
			'execute',
			adapter,
			{
				owner_session_id: 'owner',
				cwd: directory,
			},
		);
		const packet = controller.apply_result(state, record);
		expect(packet?.items[0]?.message).toContain(
			'outside the authoritative path scope',
		);
		expect(state.evidence).toEqual([]);
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('ready');
		const omitted = await controller.initiate(
			state,
			'execute',
			adapter,
			{
				owner_session_id: 'owner',
				cwd: directory,
			},
		);
		const omitted_packet = controller.apply_result(state, omitted);
		expect(omitted_packet?.items[0]?.message).toContain(
			'complete controller-observed workspace delta',
		);
		expect(state.evidence).toEqual([]);
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('ready');
	});

	it.each(['incomplete', 'refused', 'escalated', 'failed'] as const)(
		'keeps a settled %s outcome non-successful',
		async (outcome) => {
			const { state, controller } = setup();
			const adapter = create_sdk_execution_adapter({
				async run(request) {
					return {
						...successful_result(request),
						outcome,
						...(outcome === 'incomplete'
							? {}
							: {
									failure: {
										category: 'implementation' as const,
										message: `${outcome} by child`,
									},
								}),
					};
				},
			});
			const record = await controller.initiate(
				state,
				'plan',
				adapter,
				{
					owner_session_id: 'owner',
					cwd: '/repo',
				},
			);
			const packet = controller.apply_result(state, record);
			expect(packet?.items[0]?.message).toContain(outcome);
			expect(
				state.nodes.find((node) => node.id === 'plan')?.status,
			).not.toBe('succeeded');
		},
	);

	it('rejects weakened acceptance and unsafe reverted edits, then permits a truthful retry', async () => {
		const route = dispatch_task(
			{
				task: 'Update dependency safely',
				cwd: process.cwd(),
				affected_paths: ['package.json'],
				acceptance_criteria: ['dependency is updated'],
			},
			policy,
			{ workflow: 'chore', reason: 'Deterministic maintenance' },
		);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', route.affected_paths);
		let attempt = 0;
		const controller = new ExecutionController(
			new ExecutionRegistry(
				join(
					mkdtempSync(join(tmpdir(), 'execution-')),
					'registry.json',
				),
			),
			() =>
				snapshot(attempt >= 3 ? { 'package.json': 'changed' } : {}),
		);
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				attempt += 1;
				if (attempt === 1)
					return {
						...successful_result(request, []),
						acceptance_results: [
							{
								criterion: 'weaker replacement',
								status: 'met' as const,
								evidence_ids: ['result-evidence'],
							},
						],
					};
				if (attempt === 2)
					return successful_result(request, ['package.json']);
				return successful_result(request, ['package.json']);
			},
		});
		const unsafe = await controller.initiate(
			state,
			'execute',
			adapter,
			{
				owner_session_id: 'owner',
				cwd: process.cwd(),
			},
		);
		const packet = controller.apply_result(state, unsafe);
		expect(packet?.items[0]?.message).toContain(
			'replaced or reordered',
		);
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('ready');
		const reverted = await controller.initiate(
			state,
			'execute',
			adapter,
			{ owner_session_id: 'owner', cwd: process.cwd() },
		);
		const reverted_packet = controller.apply_result(state, reverted);
		expect(reverted_packet?.items[0]?.message).toContain(
			'complete controller-observed workspace delta',
		);
		const truthful = await controller.initiate(
			state,
			'execute',
			adapter,
			{ owner_session_id: 'owner', cwd: process.cwd() },
		);
		controller.apply_result(state, truthful);
		expect(
			state.nodes.find((node) => node.id === 'execute')?.status,
		).toBe('succeeded');
	});

	it('deduplicates a recursive owned attempt before spawning again', async () => {
		const { state, controller } = setup();
		let calls = 0;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				calls += 1;
				return {
					execution_id: request.execution_id,
					lifecycle: 'running',
					adapter_id: 'pi-sdk',
					adapter_version: '1',
				};
			},
		});
		const first = await controller.initiate(state, 'plan', adapter, {
			owner_session_id: 'owner',
			cwd: '/repo',
		});
		state.nodes.find((node) => node.id === 'plan')!.status = 'ready';
		await expect(
			controller.initiate(state, 'plan', adapter, {
				owner_session_id: 'owner',
				cwd: '/repo',
			}),
		).rejects.toThrow(
			`Active owned attempt already exists for ${state.workflow_id}/plan: ${first.request.execution_id}`,
		);
		expect(calls).toBe(1);
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
		let review_calls = 0;
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				if (request.review_packet) review_calls += 1;
				return {
					...successful_result(request),
					adapter_id: 'sdk',
					...(request.review_packet
						? {
								review: {
									review_id: request.review_packet.id,
									verdict:
										review_calls === 1
											? ('changes-requested' as const)
											: ('approve' as const),
									findings:
										review_calls === 1
											? [
													{
														severity: 'error' as const,
														disposition: 'must-fix' as const,
														code: 'review.fix',
														message: 'Correct the implementation',
														evidence_ids: [],
														required_action: 'Retry review',
													},
												]
											: [],
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
			cwd: process.cwd(),
			review: {
				acceptance_criteria: ['works'],
				changed_files: ['src/file.ts'],
				constraints: [],
				diff: 'diff',
			},
		});
		expect(review_calls).toBe(2);
		expect(
			state.feedback.some((packet) => packet.source === 'reviewer'),
		).toBe(true);
		expect(
			state.nodes.find((node) => node.kind === 'review')?.status,
		).toBe('succeeded');
		expect(
			state.nodes.find((node) => node.kind === 'approval')?.status,
		).toBe('ready');
	});
});
