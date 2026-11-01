import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CoordinationPoller } from './coordination-poller.js';
import { TeamDatabase } from './db/index.js';
import { execute_coordination_action } from './tools/coordination-actions.js';

const databases: TeamDatabase[] = [];
const dirs: string[] = [];
async function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'team-delivery-test-'));
	dirs.push(dir);
	const db = await TeamDatabase.open(join(dir, 'coordination.db'));
	databases.push(db);
	for (const id of ['sender', 'receiver', 'other'])
		db.register_session({ session_id: id, cwd: '/repo' });
	const send = (
		extra: Partial<Parameters<TeamDatabase['send_message']>[0]> = {},
	) =>
		db.send_message({
			from_session_id: 'sender',
			to_session_ids: ['receiver'],
			scope: 'session',
			target: 'receiver',
			body: 'hello',
			...extra,
		});
	const context = {
		ctx: { cwd: '/repo' },
		coordination_db: db,
		notify_coordination_messages: async () => {},
		require_session_id: () => 'receiver',
	};
	return { db, dir, send, context };
}
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('retry-safe messages', () => {
	it('atomically reuses one message, receipt, event, and timestamp for repeated keys across connections', async () => {
		const { db, dir, send } = await setup();
		const first = send({
			idempotency_key: 'delivery-1',
			ttl_ms: 60_000,
		});
		const second_db = await TeamDatabase.open(
			join(dir, 'coordination.db'),
		);
		databases.push(second_db);
		const second = second_db.send_message({
			from_session_id: 'sender',
			to_session_ids: ['receiver', 'receiver'],
			scope: 'session',
			target: 'receiver',
			body: 'hello',
			idempotency_key: 'delivery-1',
			ttl_ms: 60_000,
		});
		expect(second).toEqual(first);
		db.mark_messages_acknowledged('receiver', [first.message_id]);
		expect(
			send({ idempotency_key: 'delivery-1', ttl_ms: 60_000 }),
		).toEqual(first);
		expect(db.list_inbox('receiver')).toEqual([]);
		expect(
			db.read_rows('SELECT message_id FROM messages'),
		).toHaveLength(1);
		expect(
			db.read_rows('SELECT message_id FROM message_receipts'),
		).toHaveLength(1);
		expect(
			db.read_rows(
				"SELECT message_id FROM events WHERE type = 'message_sent'",
			),
		).toHaveLength(1);
	});

	it('rejects changed payloads and recipients without modifying the original message', async () => {
		const { db, send } = await setup();
		const original = send({ idempotency_key: 'same' });
		for (const extra of [
			{ body: 'changed' },
			{ urgent: true },
			{ to_session_ids: ['other'] },
			{ message_type: 'status' as const },
		])
			expect(() =>
				send({ idempotency_key: 'same', ...extra }),
			).toThrow('different message');
		expect(db.list_inbox('receiver')[0]?.message_id).toBe(
			original.message_id,
		);
		expect(db.list_inbox('other')).toEqual([]);
	});

	it('never deduplicates unkeyed sends or keys from different senders', async () => {
		const { send } = await setup();
		const ids = [
			send(),
			send(),
			send({ idempotency_key: 'key' }),
			send({ from_session_id: 'other', idempotency_key: 'key' }),
		].map((message) => message.message_id);
		expect(new Set(ids).size).toBe(4);
	});

	it('rejects non-actionable status carrying urgency or an acknowledgement requirement', async () => {
		const { send } = await setup();
		expect(send().message_type).toBe('action');
		expect(() =>
			send({ message_type: 'status', urgent: true }),
		).toThrow('Status messages cannot');
		expect(() =>
			send({ message_type: 'status', requires_ack: true }),
		).toThrow('Status messages cannot');
		expect(() => send({ status_key: 'build' })).toThrow('status_key');
		expect(() => send({ idempotency_key: ' ' })).toThrow(
			'idempotency_key',
		);
	});

	it('forwards send options through both direct and group tools', async () => {
		const { db, context } = await setup();
		const sender_context = {
			...context,
			require_session_id: () => 'sender',
		};
		const group = db.create_group({ name: 'workers', cwd: '/repo' });
		db.add_group_member({
			group_id: group.group_id,
			session_id: 'receiver',
		});
		for (const params of [
			{ action: 'session_send' as const, to: 'receiver' },
			{ action: 'group_send' as const, team_id: group.group_id },
		]) {
			await execute_coordination_action(
				{
					...params,
					message: 'build running',
					message_type: 'status',
					status_key: 'build',
					idempotency_key: params.action,
				},
				sender_context,
			);
			await execute_coordination_action(
				{
					...params,
					message: 'build running',
					message_type: 'status',
					status_key: 'build',
					idempotency_key: params.action,
				},
				sender_context,
			);
		}
		expect(db.list_inbox('receiver')).toHaveLength(2);
		expect(
			db
				.list_inbox('receiver')
				.every(
					(message) =>
						message.message_type === 'status' &&
						message.status_key === 'build',
				),
		).toBe(true);
	});
});

describe('surfacing is not completion', () => {
	it.each(['session_inbox', 'session_wait'] as const)(
		'%s suppresses automatic replay but does not claim review or completion',
		async (action) => {
			const { db, send, context } = await setup();
			const message = send();
			const result = await execute_coordination_action(
				{ action, timeout_ms: 0 },
				context,
			);
			expect(result.content[0]?.text).toContain('hello');
			const receipt = db.list_inbox('receiver', {
				include_read: true,
			})[0]!;
			expect(receipt.delivered_at).toBeDefined();
			expect(receipt.read_at).toBeUndefined();
			expect(receipt.acknowledged_at).toBeUndefined();
			const poller = new CoordinationPoller({
				db,
				get_session_id: () => 'receiver',
				should_auto_inject_messages: () => true,
			});
			const pi = { sendMessage: vi.fn() };
			poller.poll(pi);
			expect(pi.sendMessage).not.toHaveBeenCalled();
			const full = await execute_coordination_action(
				{
					action: 'session_inbox',
					message_id: message.message_id,
					mode: 'full',
				},
				context,
			);
			expect(full.content[0]?.text).toContain('hello');
		},
	);

	it('marks only a surfaced inbox page, keeping offset pagination stable', async () => {
		const { db, send, context } = await setup();
		for (let i = 0; i < 25; i++) send({ body: `message-${i}` });
		const page = await execute_coordination_action(
			{ action: 'session_inbox', limit: 5, offset: 10 },
			context,
		);
		expect(page.details).toMatchObject({
			total_count: 25,
			returned_count: 5,
			next_offset: 15,
		});
		expect(
			db.list_inbox('receiver', { undelivered_only: true }),
		).toHaveLength(20);
		const next = await execute_coordination_action(
			{ action: 'session_inbox', limit: 5, offset: 15 },
			context,
		);
		expect(next.details).toMatchObject({
			total_count: 25,
			returned_count: 5,
		});
		expect(
			db.list_inbox('receiver', { undelivered_only: true }),
		).toHaveLength(15);
	});

	it('explicit review implies surfacing, and completion implies review, without sending a reply', async () => {
		const { db, send } = await setup();
		const read = send();
		const ack = send();
		db.mark_messages_read('receiver', [read.message_id]);
		db.mark_messages_acknowledged('receiver', [ack.message_id]);
		const receipts = db.list_inbox('receiver', {
			include_read: true,
			include_acknowledged: true,
		});
		expect(
			receipts.every(
				(message) => !!message.delivered_at && !!message.read_at,
			),
		).toBe(true);
		expect(
			receipts.find(
				(message) => message.message_id === read.message_id,
			)?.acknowledged_at,
		).toBeUndefined();
		expect(
			db.read_rows('SELECT message_id FROM messages'),
		).toHaveLength(2);
	});
});
