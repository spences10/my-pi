import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
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

beforeEach(() => {
	vi.stubEnv('MY_PI_WORKER_CHILD', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	state.options = undefined;
});

function setup(
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
	const active_tools = ['workers'];
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
	} as unknown as ExtensionAPI;
	const ctx = {
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
	events.get('session_start')?.({}, ctx);
	return {
		events,
		tools,
		commands,
		confirm,
		input,
		select,
		notify,
		send_message,
		ctx,
		active_tools,
	};
}

describe('worker extension', () => {
	it('opens the worker manager only for a bare terminal command', async () => {
		const { commands, ctx, notify } = setup();
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
			const { commands, ctx, notify } = setup(true, mode);
			await commands.get('workers')!.handler('', ctx);
			expect(state.show_workers).not.toHaveBeenCalled();
			expect(notify).toHaveBeenCalledWith(
				JSON.stringify([{ id: 'owned', name: 'reviewer' }], null, 2),
				'info',
			);
		},
	);

	it('preserves explicit send/stop commands without opening the picker', async () => {
		const { commands, ctx } = setup();
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

	it('does not register spawning tools or orchestration guidance in a child', () => {
		vi.stubEnv('MY_PI_WORKER_CHILD', '1');
		const harness = setup();
		expect(harness.tools.size).toBe(0);
		expect(harness.events.size).toBe(0);
	});

	it('inherits model and thinking, and stops owned workers at session shutdown', async () => {
		const { tools, events, ctx } = setup();
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

	it('only adds worker guidance when the tool is active', () => {
		const { events, active_tools } = setup();
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
		const { confirm } = setup();
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
		const { input } = setup();
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
		const { confirm } = setup();
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

	it('fails closed without a UI and declines uncancellable editor dialogs', () => {
		const { confirm } = setup(false);
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

	it('delivers bounded peer reports as follow-ups, not user-authority messages', () => {
		const { send_message } = setup();
		state.options!.on_complete({
			id: 'owned',
			name: 'reviewer',
			cwd: '/tmp',
			status: 'idle',
			result: 'done',
		});
		expect(send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: 'rpc-worker-report',
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
		(field) => {
			const { send_message } = setup();
			const secret = 'sk-synthetic-worker-report-1234567890';
			state.options!.on_complete({
				id: 'owned',
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
			expect(report.details[field]).toContain('[REDACTED:');
			expect(report.details).toMatchObject({
				authority: 'peer-only',
				direct_user_authority: false,
			});
		},
	);

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
