import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	load_telemetry_config,
	save_telemetry_config,
} from './config.js';
import { create_telemetry_extension } from './index.js';
import type { TelemetryStore } from './types.js';

type Handler = (event: unknown, ctx: unknown) => Promise<void>;
interface Tool {
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: undefined,
		update: undefined,
		ctx: unknown,
	) => Promise<{ content: Array<{ text: string }> }>;
}

const ctx = {
	cwd: '/project',
	model: { provider: 'test', id: 'model' },
	sessionManager: { getSessionFile: () => '/sessions/one.jsonl' },
};

function fake_store(): TelemetryStore {
	return {
		insert_run: vi.fn(),
		finish_run: vi.fn(),
		insert_turn: vi.fn(),
		finish_turn: vi.fn(),
		insert_tool_call: vi.fn(),
		note_tool_update: vi.fn(),
		finish_tool_call: vi.fn(),
		insert_provider_request: vi.fn(),
		finish_provider_request: vi.fn(),
		get_stats: vi.fn(),
		query_runs: vi.fn(() => []),
		close: vi.fn(),
	} as unknown as TelemetryStore;
}

describe('telemetry tool', () => {
	const homes: string[] = [];
	const original_home = process.env.HOME;
	const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

	afterEach(() => {
		for (const home of homes.splice(0)) {
			rmSync(home, { recursive: true, force: true });
		}
		if (original_home === undefined) delete process.env.HOME;
		else process.env.HOME = original_home;
		if (original_agent_dir === undefined)
			delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
	});

	async function setup(
		options: { enabled?: boolean; saved_enabled?: boolean } = {},
	) {
		const home = join(
			tmpdir(),
			`my-pi-telemetry-tool-${randomBytes(4).toString('hex')}`,
		);
		mkdirSync(home, { recursive: true });
		homes.push(home);
		process.env.HOME = home;
		process.env.PI_CODING_AGENT_DIR = join(home, '.pi', 'agent');
		const db_path = join(home, 'telemetry.db');
		const store = fake_store();
		const load_store = vi.fn(async () => store);
		if (options.saved_enabled) {
			save_telemetry_config({ version: 1, enabled: true });
		}
		const handlers = new Map<string, Handler>();
		let tool: Tool | undefined;
		const pi = {
			on: (name: string, handler: Handler) =>
				handlers.set(name, handler),
			registerCommand: () => {},
			registerTool: (definition: Tool) => {
				tool = definition;
			},
		} as unknown as ExtensionAPI;
		await create_telemetry_extension({
			...options,
			db_path,
			load_store,
			now: () => 1000,
		})(pi);
		const call = async (params: Record<string, unknown>) =>
			(await tool!.execute('id', params, undefined, undefined, ctx))
				.content[0]!.text;
		const emit = (name: string, event: unknown = {}) =>
			handlers.get(name)!(event, ctx);
		return { call, store, emit, handlers, db_path, load_store };
	}

	it('turns recording on for the session without saving a default', async () => {
		const { call, store, handlers, emit } = await setup();
		await emit('agent_start');
		await emit('turn_start', { turnIndex: 0, timestamp: 900 });

		expect(await call({ action: 'on' })).toContain(
			'on for this session only',
		);
		expect(store.insert_run).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: '/project',
				session_file: '/sessions/one.jsonl',
			}),
		);
		expect(load_telemetry_config().enabled).toBe(false);
		expect(store.insert_turn).toHaveBeenCalledWith(
			expect.objectContaining({ turn_index: 0, started_at: 1000 }),
		);

		await handlers.get('tool_execution_start')!(
			{ toolCallId: 'call-1', toolName: 'read', args: {} },
			ctx,
		);
		expect(store.insert_tool_call).toHaveBeenCalledTimes(1);
	});

	it('closes a recording only after the final tool and native turn end', async () => {
		const { call, store, emit } = await setup();

		expect(await call({ action: 'off' })).toBe(
			'Telemetry is already off.',
		);
		await emit('turn_start', { turnIndex: 0, timestamp: 900 });
		await call({ action: 'on' });
		await emit('tool_execution_start', {
			toolCallId: 'off',
			toolName: 'telemetry',
			args: { action: 'off' },
		});
		expect(await call({ action: 'off' })).toContain(
			'stop at the end of this turn',
		);
		expect(store.finish_run).not.toHaveBeenCalled();
		expect(store.close).not.toHaveBeenCalled();
		await emit('tool_execution_end', {
			toolCallId: 'off',
			isError: false,
			result: {},
		});
		await emit('turn_end', {
			turnIndex: 0,
			toolResults: [{}],
			message: { stopReason: 'toolUse' },
		});
		expect(store.finish_tool_call).toHaveBeenCalledWith(
			expect.objectContaining({
				tool_call_id: 'off',
				is_error: false,
			}),
		);
		expect(store.finish_turn).toHaveBeenCalledTimes(1);
		expect(store.finish_run).toHaveBeenCalledWith(
			expect.objectContaining({ success: null, error_message: null }),
		);
		const closed_at = vi.mocked(store.close).mock
			.invocationCallOrder[0]!;
		expect(
			vi.mocked(store.finish_tool_call).mock.invocationCallOrder[0],
		).toBeLessThan(closed_at);
		expect(
			vi.mocked(store.finish_turn).mock.invocationCallOrder[0],
		).toBeLessThan(closed_at);
		await emit('agent_end', { messages: [] });
		await emit('agent_settled', { aborted: false });
		expect(store.finish_run).toHaveBeenCalledTimes(1);
		expect(store.close).toHaveBeenCalledTimes(1);
		expect(await call({ action: 'status' })).toContain(
			'telemetry disabled now',
		);
	});

	it('leaves activation retryable when opening the database fails', async () => {
		const { call, store, load_store } = await setup();
		load_store.mockRejectedValueOnce(
			new Error('cannot open database'),
		);
		await expect(call({ action: 'on' })).rejects.toThrow(
			'cannot open database',
		);
		expect(await call({ action: 'status' })).toContain(
			'telemetry disabled now',
		);
		expect(load_telemetry_config().enabled).toBe(false);
		expect(await call({ action: 'on' })).toContain(
			'on for this session only',
		);
		expect(load_store).toHaveBeenCalledTimes(2);
		expect(store.insert_run).toHaveBeenCalledTimes(1);
	});

	it('closes a failed initialization and retries without retaining task labels', async () => {
		const { call, store } = await setup();
		vi.mocked(store.insert_run).mockImplementationOnce(() => {
			throw new Error('cannot insert run');
		});
		await expect(
			call({ action: 'on', eval_case_id: 'failed-task' }),
		).rejects.toThrow('cannot insert run');
		expect(store.close).toHaveBeenCalledTimes(1);
		expect(await call({ action: 'status' })).toContain(
			'telemetry disabled now',
		);
		await call({ action: 'on', eval_case_id: 'next-task' });
		expect(store.insert_run).toHaveBeenLastCalledWith(
			expect.objectContaining({ eval_case_id: 'next-task' }),
		);
	});

	it('does not relabel or stop recording enabled by the user', async () => {
		const { call, store, emit } = await setup({
			saved_enabled: true,
		});
		await emit('agent_start');
		expect(
			await call({ action: 'on', eval_case_id: 'different-task' }),
		).toContain('already on');
		expect(await call({ action: 'off' })).toContain(
			'only the user turns it off',
		);
		expect(store.insert_run).toHaveBeenCalledTimes(1);
		expect(store.close).not.toHaveBeenCalled();
		expect(load_telemetry_config().enabled).toBe(true);
	});

	it('retains task labels across native runs until stopped, then clears them', async () => {
		const { call, store, emit } = await setup();
		await call({
			action: 'on',
			eval_suite: 'repeatable',
			eval_case_id: 'check-links',
		});
		await emit('agent_end', {
			messages: [{ role: 'assistant', stopReason: 'stop' }],
		});
		await emit('agent_start');
		for (const [run] of vi.mocked(store.insert_run).mock.calls) {
			expect(run).toMatchObject({
				eval_suite: 'repeatable',
				eval_case_id: 'check-links',
			});
		}
		await call({ action: 'off' });
		await emit('agent_settled', { aborted: false });
		await call({
			action: 'on',
			eval_suite: 'other',
			eval_case_id: 'next-task',
		});
		expect(store.insert_run).toHaveBeenLastCalledWith(
			expect.objectContaining({
				eval_suite: 'other',
				eval_case_id: 'next-task',
			}),
		);
	});

	it('restores tool-owned recording on native aborted settlement', async () => {
		const { call, store, emit } = await setup();
		await call({ action: 'on' });
		await emit('agent_end', {
			messages: [{ role: 'assistant', stopReason: 'aborted' }],
		});
		await emit('agent_settled', { aborted: true });
		expect(store.finish_run).toHaveBeenCalledTimes(1);
		expect(store.finish_run).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error_message: 'agent aborted',
			}),
		);
		expect(store.close).toHaveBeenCalledTimes(1);
		expect(await call({ action: 'status' })).toContain(
			'telemetry disabled now',
		);
	});

	it('leaves a process override alone', async () => {
		const enabled = await setup({ enabled: true });
		expect(await enabled.call({ action: 'off' })).toContain(
			'--telemetry',
		);
		expect(enabled.store.close).not.toHaveBeenCalled();

		const disabled = await setup({ enabled: false });
		expect(await disabled.call({ action: 'on' })).toContain(
			'--no-telemetry',
		);
		expect(disabled.store.insert_run).not.toHaveBeenCalled();
	});

	it('queries runs with filters and a default limit', async () => {
		const { call, store, db_path, emit } = await setup();

		expect(await call({ action: 'query' })).toBe(
			`No telemetry database at ${db_path}`,
		);

		writeFileSync(db_path, '');
		await call({ action: 'on', eval_case_id: 'task-a' });
		await call({ action: 'off' });
		const result = JSON.parse(
			await call({
				action: 'query',
				cwd: '/project',
				eval_case_id: 'task-a',
			}),
		);
		expect(result.runs).toEqual([]);
		expect(result.active_run_id).toEqual(expect.any(String));
		expect(result.stop_pending).toBe(true);
		expect(store.query_runs).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: '/project',
				eval_case_id: 'task-a',
				limit: 20,
			}),
		);
		expect(store.close).not.toHaveBeenCalled();
		await emit('turn_end', {
			turnIndex: 0,
			toolResults: [],
			message: {},
		});
		const completed = JSON.parse(await call({ action: 'query' }));
		expect(completed.active_run_id).toBeNull();
		expect(completed.stop_pending).toBe(false);
		expect(store.close).toHaveBeenCalledTimes(2);
	});
});
