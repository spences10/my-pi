import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { TeamDatabase } from '@spences10/pi-team-mode/coordination';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vite-plus/test';
import workers, { worker_launch } from './index.js';
import type { ManagerOptions } from './manager.js';

const state = vi.hoisted(() => ({
	options: undefined as ManagerOptions | undefined,
	dispose: vi.fn(),
	spawn: vi.fn(async () => ({ id: 'owned' })),
	send: vi.fn(),
	stop: vi.fn(),
	show_workers: vi.fn(),
}));

vi.mock('./tui.js', () => ({ show_workers: state.show_workers }));

vi.mock('./manager.js', () => ({
	child_env: 'MY_PI_WORKER_CHILD',
	WorkerManager: class {
		constructor(options: ManagerOptions) {
			state.options = options;
		}
		list() {
			return [{ id: 'owned', name: 'reviewer' }];
		}
		dispose = state.dispose;
		spawn = state.spawn;
		send = state.send;
		stop = state.stop;
	},
}));

let directory: string;
const shutdowns: Function[] = [];

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'workers-extension-'));
	vi.stubEnv(
		'MY_PI_COORDINATION_DB',
		join(directory, 'coordination.db'),
	);
	vi.stubEnv('MY_PI_WORKER_CHILD', '');
});

afterEach(async () => {
	for (const shutdown of shutdowns.splice(0)) await shutdown();
	rmSync(directory, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	state.options = undefined;
});

async function setup(
	has_ui = true,
	mode: ExtensionContext['mode'] = 'tui',
) {
	const events = new Map<string, Function>();
	const tools = new Map<string, { execute: Function }>();
	const commands = new Map<string, { handler: Function }>();
	const confirm = vi.fn(async () => false);
	const input = vi.fn(async () => undefined);
	const select = vi.fn(async () => undefined);
	const notify = vi.fn();
	const send_message = vi.fn();
	const register_message_renderer = vi.fn();
	const active_tools = ['workers'];

	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial SDK fixture; only exercised members are provided.
	const pi = {
		on: (name: string, handler: Function) =>
			events.set(name, handler),
		registerTool: (tool: { name: string; execute: Function }) =>
			tools.set(tool.name, tool),
		registerCommand: (name: string, command: { handler: Function }) =>
			commands.set(name, command),
		getActiveTools: () => active_tools,
		getThinkingLevel: () => 'high',
		sendMessage: send_message,
		registerMessageRenderer: register_message_renderer,
	} as unknown as ExtensionAPI;

	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial SDK fixture; only exercised members are provided.
	const ctx = {
		cwd: directory,
		isIdle: () => true,
		mode,
		hasUI: has_ui,
		model: { provider: 'test', id: 'model' },
		sessionManager: {
			getSessionFile: () => '/tmp/parent.jsonl',
			getSessionId: () => 'parent',
		},
		ui: { confirm, input, select, notify },
	} as unknown as ExtensionContext;

	workers(pi);
	await events.get('session_start')?.({}, ctx);
	state.options?.on_started?.({
		id: 'owned',
		session_id: 'worker',
		name: 'reviewer',
		cwd: directory,
		status: 'idle',
	});

	if (events.has('session_shutdown'))
		shutdowns.push(events.get('session_shutdown')!);

	return {
		events,
		tools,
		commands,
		confirm,
		input,
		select,
		notify,
		send_message,
		register_message_renderer,
		ctx,
		active_tools,
	};
}

describe('worker extension', () => {
	it('registers compact message and tool renderers', async () => {
		const { register_message_renderer, tools } = await setup();
		expect(register_message_renderer).toHaveBeenCalledWith(
			'rpc-worker-report',
			expect.any(Function),
		);
		expect(tools.get('workers')).toEqual(
			expect.objectContaining({
				renderCall: expect.any(Function),
				renderResult: expect.any(Function),
			}),
		);
	});

	it('opens the worker manager only for a bare terminal command', async () => {
		const { commands, ctx, notify } = await setup();
		await commands.get('workers')!.handler('', ctx);
		expect(state.show_workers).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({ list: expect.any(Function) }),
		);
		expect(notify).not.toHaveBeenCalled();
	});

	it.each(['rpc', 'json', 'print'] as const)(
		'keeps the JSON fallback in %s mode even when hasUI is true',
		async (mode) => {
			const { commands, ctx, notify } = await setup(true, mode);
			await commands.get('workers')!.handler('', ctx);
			expect(state.show_workers).not.toHaveBeenCalled();
			expect(notify).toHaveBeenCalledWith(
				JSON.stringify([{ id: 'owned', name: 'reviewer' }], null, 2),
				'info',
			);
		},
	);

	it('preserves explicit send/stop commands without opening the picker', async () => {
		const { commands, ctx } = await setup();
		await commands
			.get('workers')!
			.handler('send reviewer Check error paths', ctx);
		await commands.get('workers')!.handler('stop owned', ctx);
		expect(state.send).toHaveBeenCalledWith(
			'reviewer',
			'Check error paths',
		);
		expect(state.stop).toHaveBeenCalledWith('owned');
		expect(state.show_workers).not.toHaveBeenCalled();
	});

	it('does not register spawning tools or orchestration guidance in a child', async () => {
		vi.stubEnv('MY_PI_WORKER_CHILD', '1');
		const harness = await setup();
		expect(harness.tools.size).toBe(0);
		expect(harness.events.size).toBe(0);
	});

	it('inherits model and thinking, and stops owned workers at session shutdown', async () => {
		const { tools, events, ctx } = await setup();
		const controller = new AbortController();
		await tools.get('workers')!.execute(
			'call',
			{
				action: 'spawn',
				name: 'reviewer',
				task: 'Review',
				cwd: '/tmp',
			},
			controller.signal,
			undefined,
			ctx,
		);
		expect(state.spawn).toHaveBeenCalledWith(
			{
				name: 'reviewer',
				task: 'Review',
				cwd: '/tmp',
				model: 'test/model',
				thinking: 'high',
			},
			controller.signal,
		);
		await events.get('session_shutdown')!();
		expect(state.dispose).toHaveBeenCalledOnce();
		await expect(
			tools
				.get('workers')!
				.execute(
					'call',
					{ action: 'list' },
					undefined,
					undefined,
					ctx,
				),
		).rejects.toThrow('not initialized');
	});

	it('only adds worker guidance when the tool is active', async () => {
		const { events, active_tools } = await setup();
		const event = { systemPromptOptions: { sections: {} } };
		events.get('before_agent_start')!(event);
		expect(event.systemPromptOptions.sections).toHaveProperty(
			'workers',
		);
		active_tools.length = 0;
		const inactive = { systemPromptOptions: { sections: {} } };
		events.get('before_agent_start')!(inactive);
		expect(inactive.systemPromptOptions.sections).not.toHaveProperty(
			'workers',
		);
	});

	it('labels worker approvals and returns the human answer', async () => {
		const { confirm } = await setup();
		const respond = vi.fn();
		state.options!.on_ui(
			'owned',
			{
				type: 'extension_ui_request',
				id: 'dialog',
				method: 'confirm',
				title: 'Allow?',
				message: 'A command',
			},
			respond,
		);
		await expect.poll(() => respond.mock.calls.length).toBe(1);
		expect(confirm).toHaveBeenCalledWith(
			'[reviewer] Allow?',
			'A command',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(respond).toHaveBeenCalledWith({ confirmed: false });
	});

	it('serializes dialogs and explicitly cancels dismissed inputs', async () => {
		const { input } = await setup();
		const respond = vi.fn();

		for (const id of ['first', 'second'])
			state.options!.on_ui(
				'owned',
				{
					type: 'extension_ui_request',
					id,
					method: 'input',
					title: id,
				},
				respond,
			);
		await expect.poll(() => respond.mock.calls.length).toBe(2);
		expect(input).toHaveBeenCalledTimes(2);
		expect(respond).toHaveBeenCalledWith({ cancelled: true });
	});

	it('dismisses a stale dialog when its worker turn ends', async () => {
		const { confirm } = await setup();
		confirm.mockImplementation(
			(
				_title?: unknown,
				_message?: unknown,
				options?: { signal?: AbortSignal },
			) =>
				new Promise<boolean>((resolve) =>
					options?.signal?.addEventListener(
						'abort',
						() => resolve(false),
						{ once: true },
					),
				),
		);
		const respond = vi.fn();
		state.options!.on_ui(
			'owned',
			{
				type: 'extension_ui_request',
				id: 'dialog',
				method: 'confirm',
				title: 'Allow?',
				message: 'A command',
			},
			respond,
		);
		await expect.poll(() => confirm.mock.calls.length).toBe(1);
		state.options!.on_dialogs_end('owned');
		await expect.poll(() => respond.mock.calls.length).toBe(1);
		expect(respond).toHaveBeenCalledWith({ confirmed: false });
	});

	it('fails closed without a UI and declines uncancellable editor dialogs', async () => {
		const { confirm } = await setup(false);
		const respond = vi.fn();
		state.options!.on_ui(
			'owned',
			{
				type: 'extension_ui_request',
				id: 'dialog',
				method: 'confirm',
				title: 'Allow?',
				message: 'A command',
			},
			respond,
		);
		state.options!.on_ui(
			'owned',
			{
				type: 'extension_ui_request',
				id: 'editor',
				method: 'editor',
				title: 'Edit',
			},
			respond,
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(respond).toHaveBeenCalledTimes(2);
		expect(respond).toHaveBeenCalledWith({ cancelled: true });
	});

	it('delivers persisted peer reports through the recipient policy, not user-authority messages', async () => {
		const { send_message } = await setup();
		state.options!.on_complete({
			id: 'owned',
			session_id: 'worker',
			name: 'reviewer',
			cwd: '/tmp',
			status: 'idle',
			result: 'done',
		});
		expect(send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: 'team-mode-peer-message',
				details: expect.objectContaining({
					authority: 'peer-only',
					direct_user_authority: false,
				}),
			}),
			{ triggerTurn: true, deliverAs: 'followUp' },
		);
	});

	it.each(['result', 'error'] as const)(
		'redacts completion %s content and all custom-message details without tool-result hooks',
		async (field) => {
			const { send_message } = await setup();
			const secret = 'sk-synthetic-worker-report-1234567890';
			state.options!.on_complete({
				id: 'owned',
				session_id: 'worker',
				name: `reviewer-${secret}`,
				cwd: `/tmp/${secret}`,
				session_file: `/tmp/${secret}/session.jsonl`,
				status: 'idle',
				[field]: `Worker diagnostic: ${secret}`,
			});
			const [report] = send_message.mock.calls[0];
			expect(report.content).not.toContain(secret);
			expect(report.content).toContain('[REDACTED:');
			expect(JSON.stringify(report.details)).not.toContain(secret);

			const db = await TeamDatabase.open(
				process.env.MY_PI_COORDINATION_DB!,
			);

			try {
				const stored = db.list_inbox('parent')[0];
				expect(stored.body).not.toContain(secret);
				expect(stored.body).toContain('[REDACTED:');
			} finally {
				db.close();
			}

			expect(report.details).toMatchObject({
				authority: 'peer-only',
				direct_user_authority: false,
			});
		},
	);

	it('pauses completion notifications without stopping workers or losing results, and resumes without a backlog', async () => {
		const { commands, ctx, events, send_message, tools } =
			await setup();

		await commands.get('workers')!.handler('pause', ctx);

		const complete = () =>
			state.options!.on_complete({
				id: 'owned',
				session_id: 'worker',
				name: 'reviewer',
				cwd: directory,
				status: 'idle',
				result: 'saved result',
			});

		complete();
		expect(send_message).not.toHaveBeenCalled();
		expect(state.stop).not.toHaveBeenCalled();
		events.get('before_agent_start')!({
			messageType: 'user',
			systemPromptOptions: { sections: {} },
		});
		expect(send_message).not.toHaveBeenCalled();
		await tools
			.get('workers')!
			.execute(
				'resume',
				{ action: 'resume' },
				undefined,
				undefined,
				ctx,
			);
		expect(
			events.get('agent_before_settle')!({ outcome: 'completed' }),
		).toBeUndefined();
		complete();
		expect(send_message).toHaveBeenCalledTimes(1);

		const db = await TeamDatabase.open(
			process.env.MY_PI_COORDINATION_DB!,
		);

		try {
			expect(db.list_inbox('parent')).toHaveLength(2);
		} finally {
			db.close();
		}
	});

	it('uses only the Team Mode notification path when that tool is active', async () => {
		const { active_tools, send_message } = await setup();
		active_tools.push('team');
		state.options!.on_complete({
			id: 'owned',
			session_id: 'worker',
			name: 'reviewer',
			cwd: directory,
			status: 'idle',
			result: 'done',
		});
		expect(send_message).not.toHaveBeenCalled();

		const db = await TeamDatabase.open(
			process.env.MY_PI_COORDINATION_DB!,
		);

		try {
			expect(db.list_auto_inbox('parent')).toHaveLength(1);
		} finally {
			db.close();
		}
	});

	it('retains late completion after collaboration closure without waking the parent', async () => {
		const { send_message } = await setup();

		const db = await TeamDatabase.open(
			process.env.MY_PI_COORDINATION_DB!,
		);

		try {
			db.delivery.close_group(state.options!.group_id!, 'parent');
			const next_group = state.options!.get_group_id!();
			expect(next_group).not.toBe(state.options!.group_id);
			expect(
				db.get_group(state.options!.group_id!)?.closed_at,
			).toBeTruthy();
		} finally {
			db.close();
		}

		state.options!.on_complete({
			id: 'owned',
			session_id: 'worker',
			name: 'reviewer',
			cwd: directory,
			status: 'idle',
			result: 'late result',
		});
		expect(send_message).not.toHaveBeenCalled();
	});

	it('preserves explicit extensions but not parent prompts, session paths or trust overrides', () => {
		const launch = worker_launch(
			[
				'node',
				import.meta.filename,
				'-e',
				import.meta.filename,
				'--extension=provider.ts',
				'--session',
				'/tmp/parent',
				'--approve',
				'parent prompt',
			],
			process.execPath,
		);

		expect(launch.args).toEqual([
			import.meta.filename,
			'-e',
			import.meta.filename,
			'-e',
			'provider.ts',
		]);
	});
});
