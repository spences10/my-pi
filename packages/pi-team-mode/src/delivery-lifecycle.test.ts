import type {
	AgentBeforeSettleEventResult,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { create_peer_message_delivery } from './coordination-formatting.js';
import { TeamDatabase } from './db/index.js';
import team_mode from './index.js';

vi.mock('./coordination-broker.js', () => ({
	ensure_coordination_broker: vi.fn(async () => {}),
	CoordinationBrokerClient: class {
		start() {}
		stop() {}
		async notify_messages() {}
	},
}));

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const run of cleanup.splice(0)) await run();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

async function setup(reconcile = false) {
	vi.useFakeTimers();
	const dir = mkdtempSync(join(tmpdir(), 'team-lifecycle-'));
	const path = join(dir, 'coordination.db');
	vi.stubEnv('MY_PI_COORDINATION_DB', path);
	vi.stubEnv('MY_PI_TEAM_AUTO_INJECT_MESSAGES', 'true');
	const db = await TeamDatabase.open(path);
	for (const id of ['sender', 'receiver'])
		db.register_session({ session_id: id, cwd: '/repo' });
	const send = (status = false) =>
		db.send_message({
			from_session_id: 'sender',
			to_session_ids: ['receiver'],
			scope: 'session',
			target: 'receiver',
			body: status ? 'Build running' : 'Review required',
			message_type: status ? 'status' : 'action',
			status_key: status ? 'build' : undefined,
		});
	const historical = reconcile
		? create_peer_message_delivery('receiver', [
				{
					...send(),
					to_session_id: 'receiver',
					receipt_created_at: '2026-01-01',
				},
			])
		: undefined;
	const handlers = new Map<string, (...args: never[]) => unknown>();
	const isIdle = vi.fn(() => true);
	const ctx = {
		cwd: '/repo',
		isIdle,
		sessionManager: {
			getSessionId: () => 'receiver',
			getSessionFile: () => undefined,
			getBranch: () =>
				historical ? [{ type: 'custom_message', ...historical }] : [],
		},
	} as unknown as ExtensionContext;
	const pi = {
		on: vi.fn(
			(name: string, handler: (...args: never[]) => unknown) => {
				handlers.set(name, handler);
			},
		),
		getSessionName: () => undefined,
		getActiveTools: () => ['team'],
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		sendMessage: vi.fn(),
	};
	const emit = async (name: string, event: unknown = {}) =>
		handlers.get(name)?.(event as never, ctx as never);
	await team_mode(pi as unknown as ExtensionAPI);
	cleanup.push(async () => {
		await emit('session_shutdown');
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});
	await emit('session_start');
	return { db, send, emit, isIdle, pi, handlers, historical };
}

function user_start() {
	return {
		messageType: 'user',
		prompt: 'Continue the authorized task',
		systemPromptOptions: { selectedTools: ['team'], sections: {} },
	};
}

describe('upstream Team Mode lifecycle integration', () => {
	it('uses actual idle state rather than agent_end to gate automatic delivery', async () => {
		const { send, isIdle, pi, handlers } = await setup();
		expect(handlers.has('agent_end')).toBe(false);
		isIdle.mockReturnValue(false);
		send();
		vi.advanceTimersByTime(1000);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		isIdle.mockReturnValue(true);
		vi.advanceTimersByTime(1000);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it('injects coalesced status into an existing user run without a wake-up', async () => {
		const { db, send, emit, pi } = await setup();
		const first = send(true);
		const last = send(true);
		vi.advanceTimersByTime(1000);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		const result = (await emit(
			'before_agent_start',
			user_start(),
		)) as BeforeAgentStartEventResult;
		expect(result.message?.content).toContain('Build running');
		await emit('message_end', {
			message: { role: 'custom', ...result.message },
		});
		expect(
			db.list_inbox('receiver', { undelivered_only: true }),
		).toEqual([]);
		expect(
			db.list_inbox('receiver').map((message) => message.message_id),
		).toEqual([first.message_id, last.message_id]);
		expect(
			db
				.list_inbox('receiver')
				.every(
					(message) => !message.read_at && !message.acknowledged_at,
				),
		).toBe(true);
	});

	it('requests a bounded final continuation only for actionable messages and completed runs', async () => {
		const { send, emit, pi } = await setup();
		send(true);
		expect(
			await emit('agent_before_settle', {
				outcome: 'completed',
				context: { canContinue: true },
			}),
		).toBeUndefined();
		send();

		const result = (await emit('agent_before_settle', {
			outcome: 'completed',
			context: { canContinue: false },
		})) as AgentBeforeSettleEventResult;
		expect(result.continue).toBe(true);
		expect(result.entries).toHaveLength(1);
		expect(result.entries?.[0]).toMatchObject({
			type: 'custom_message',
			details: {
				messages: [
					{ message_type: 'action' },
					{ message_type: 'status' },
				],
			},
		});
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it('does not restart aborted work until the user starts another run', async () => {
		const { send, emit, pi } = await setup();
		await emit('agent_settled', { aborted: true });
		send();
		vi.advanceTimersByTime(2000);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		const result = (await emit(
			'before_agent_start',
			user_start(),
		)) as BeforeAgentStartEventResult;
		expect(result.message?.content).toContain('Review required');
	});

	it('reconciles persisted branch deliveries after a crash before the receipt write', async () => {
		const { db, pi, historical } = await setup(true);
		expect(historical).toBeDefined();
		expect(
			db.list_inbox('receiver', { undelivered_only: true }),
		).toEqual([]);
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it('does not inject when Team Mode is absent from the active prompt', async () => {
		const { send, emit, pi } = await setup();
		const event = user_start();
		event.systemPromptOptions.selectedTools = ['read'];
		expect(await emit('before_agent_start', event)).toBeUndefined();
		send();
		vi.advanceTimersByTime(1000);
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});
});
