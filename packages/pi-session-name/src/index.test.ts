import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import session_name, { clean_name, naming_context } from './index.js';

function fixture() {
	const events = new Map<string, Function>();
	const commands = new Map<string, { handler: Function }>();
	let name: string | undefined;
	let session = 'one';
	let leaf = 'leaf-one';
	const messages = [
		{ role: 'user', content: 'Fix session naming' },
		{
			role: 'assistant',
			content: [{ type: 'text', text: 'Fixed the naming issue' }],
			stopReason: 'stop',
		},
	];
	const result = {
		content: [{ type: 'text', text: 'Fix Session Naming' }],
		stopReason: 'stop',
	};
	const streamSimple = vi.fn(
		(
			_model: unknown,
			_context: unknown,
			_options: { signal: AbortSignal },
		) => ({ result: async () => result }),
	);
	const setSessionName = vi.fn((value: string) => {
		name = value;
	});
	session_name({
		on: (key: string, handler: Function) => events.set(key, handler),
		registerCommand: (key: string, command: { handler: Function }) =>
			commands.set(key, command),
		getSessionName: () => name,
		setSessionName,
	} as unknown as ExtensionAPI);
	const notify = vi.fn();
	const ctx = {
		mode: 'tui',
		model: {
			id: 'configured-model',
			provider: 'configured-provider',
		},
		modelRegistry: { streamSimple },
		sessionManager: {
			getBranch: () =>
				messages.map((message, index) => ({
					id: `${leaf}-${index}`,
					type: 'message',
					message,
				})),
			getSessionId: () => session,
			getLeafId: () => leaf,
		},
		ui: { notify },
	} as unknown as ExtensionContext;
	return {
		ctx,
		events,
		messages,
		result,
		streamSimple,
		setSessionName,
		notify,
		emit: (key: string, event = { aborted: false }) =>
			events.get(key)?.(event, ctx),
		command: (args = '') =>
			commands.get('session-name')!.handler(args, ctx),
		setName: (value: string) => {
			name = value;
		},
		setSession: (value: string) => {
			session = value;
		},
		setLeaf: (value: string) => {
			leaf = value;
		},
	};
}

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('session naming', () => {
	it('cleans names and bounds model input without tool outputs or thinking', () => {
		expect(clean_name('"Fíx AUTH!!"\nExplanation')).toBe('fix-auth');
		expect(clean_name('x'.repeat(100))).toHaveLength(50);
		expect(clean_name('---')).toBe('');
		const context = naming_context([
			{ role: 'user', content: 'request'.repeat(1000) },
			{ role: 'toolResult', content: 'SECRET_TOOL_OUTPUT' },
			{
				role: 'assistant',
				stopReason: 'stop',
				content: [
					{ type: 'thinking', text: 'PRIVATE_THINKING' },
					{ type: 'text', text: 'Done' },
				],
			},
		]);
		expect(JSON.stringify(context)).not.toMatch(
			/SECRET_TOOL_OUTPUT|PRIVATE_THINKING/,
		);
		expect(JSON.stringify(context).length).toBeLessThan(2600);
	});

	it('names only after a successful settled exchange using the configured model', async () => {
		const f = fixture();
		f.emit('agent_end');
		expect(f.streamSimple).not.toHaveBeenCalled();
		f.emit('agent_settled');
		await flush();
		expect(f.setSessionName).toHaveBeenCalledWith(
			'fix-session-naming',
		);
		expect(f.streamSimple.mock.calls[0]![0]).toBe(f.ctx.model);
		f.emit('agent_settled');
		expect(f.streamSimple).toHaveBeenCalledTimes(1);
	});

	it('does not name failed, aborted, incomplete, or headless interactions', async () => {
		const f = fixture();
		f.emit('agent_settled', { aborted: true });
		f.messages[1]!.stopReason = 'error';
		f.emit('agent_settled');
		f.messages[1]!.stopReason = 'toolUse';
		f.emit('agent_settled');
		f.messages[1]!.stopReason = 'stop';
		Object.assign(f.ctx, { mode: 'json' });
		f.emit('agent_settled');
		await flush();
		expect(f.streamSimple).not.toHaveBeenCalled();
	});

	it('never overwrites an existing manual name', async () => {
		const f = fixture();
		f.setName('my-manual-name');
		f.emit('agent_settled');
		await f.command();
		expect(f.streamSimple).not.toHaveBeenCalled();
		expect(f.setSessionName).not.toHaveBeenCalled();
	});

	it.each([
		'manual',
		'session',
		'branch',
		'session_shutdown',
		'session_start',
	])('discards a delayed result after %s changes', async (change) => {
		const f = fixture();
		let resolve!: (value: typeof f.result) => void;
		f.streamSimple.mockReturnValue({
			result: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		f.emit('agent_settled');
		if (change === 'manual') f.setName('manual');
		else if (change === 'session') f.setSession('two');
		else if (change === 'branch') f.setLeaf('other-leaf');
		else f.emit(change);
		resolve(f.result);
		await flush();
		expect(f.setSessionName).not.toHaveBeenCalled();
		if (change.startsWith('session_'))
			expect(f.streamSimple.mock.calls[0]![2].signal.aborted).toBe(
				true,
			);
	});

	it('ignores metadata-only leaf changes from timer or other observers', async () => {
		const f = fixture();
		let resolve!: (value: typeof f.result) => void;
		f.streamSimple.mockReturnValue({
			result: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		f.emit('agent_settled');
		f.ctx.sessionManager.getLeafId = () =>
			'new-observer-metadata-leaf';
		resolve(f.result);
		await flush();
		expect(f.setSessionName).toHaveBeenCalledTimes(1);
	});

	it('cancels stale work when a new run starts and can name the next exchange', async () => {
		const f = fixture();
		let resolve!: (value: typeof f.result) => void;
		f.streamSimple.mockReturnValueOnce({
			result: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		f.emit('agent_settled');
		f.emit('agent_start');
		resolve(f.result);
		await flush();
		expect(f.setSessionName).not.toHaveBeenCalled();
		f.emit('agent_settled');
		await flush();
		expect(f.setSessionName).toHaveBeenCalledTimes(1);
	});

	it('reports provider failures once and supports explicit retry', async () => {
		const f = fixture();
		f.streamSimple.mockReturnValueOnce({
			result: async () => {
				throw new Error('provider failed');
			},
		});
		f.emit('agent_settled');
		await flush();
		f.emit('agent_settled');
		expect(f.streamSimple).toHaveBeenCalledTimes(1);
		expect(f.notify).toHaveBeenCalledWith(
			expect.stringContaining('/session-name'),
			'warning',
		);
		await f.command('--auto');
		expect(f.setSessionName).toHaveBeenCalledTimes(1);
	});

	it.each(['error', 'aborted', 'empty'])(
		'ignores unusable model response: %s',
		async (kind) => {
			const f = fixture();
			if (kind === 'empty') f.result.content = [];
			else f.result.stopReason = kind;
			await f.command();
			expect(f.setSessionName).not.toHaveBeenCalled();
		},
	);

	it('clears the request deadline on shutdown even if the provider ignores cancellation', async () => {
		vi.useFakeTimers();
		const f = fixture();
		let resolve!: (value: typeof f.result) => void;
		f.streamSimple.mockReturnValue({
			result: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		f.emit('agent_settled');
		expect(vi.getTimerCount()).toBe(1);
		f.emit('session_shutdown');
		expect(vi.getTimerCount()).toBe(0);
		resolve(f.result);
		await flush();
		expect(f.setSessionName).not.toHaveBeenCalled();
	});

	it('bounds naming requests and discards late replies after timeout', async () => {
		vi.useFakeTimers();
		const f = fixture();
		let resolve!: (value: typeof f.result) => void;
		f.streamSimple.mockReturnValue({
			result: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		f.emit('agent_settled');
		await vi.advanceTimersByTimeAsync(15000);
		expect(f.streamSimple.mock.calls[0]![2].signal.aborted).toBe(
			true,
		);
		resolve(f.result);
		await flush();
		expect(f.setSessionName).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		expect(f.notify).toHaveBeenCalledWith(
			expect.stringContaining('timed out'),
			'warning',
		);
		f.streamSimple.mockReturnValueOnce({
			result: async () => f.result,
		});
		await f.command();
		expect(f.setSessionName).toHaveBeenCalledTimes(1);
	});
});
