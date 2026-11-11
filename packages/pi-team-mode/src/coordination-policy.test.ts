import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { CoordinationPoller } from './coordination-poller.js';
import { TeamDatabase } from './db/index.js';
import { execute_coordination_action } from './tools/coordination-actions.js';

const cleanup: (() => void)[] = [];

afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});

async function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'team-policy-'));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'bus.db');
	const db = await TeamDatabase.open(path);
	cleanup.push(() => db.close());

	for (const id of [
		'parent',
		'pricing',
		'writer',
		'validator',
		'stranger',
	])
		db.register_session({
			session_id: id,
			cwd: '/same-repo',
			agent_name: 'duplicate-name',
		});

	const group = db.create_group({
		name: 'durable-task',
		created_by_session_id: 'parent',
	});

	for (const id of ['writer', 'validator']) {
		db.register_session({
			session_id: id,
			cwd: '/same-repo',
			parent_session_id: 'parent',
			metadata: { worker_id: id, worker_group_id: group.group_id },
		});
		db.add_group_member({ group_id: group.group_id, session_id: id });
	}

	const send = (
		sender = 'writer',
		recipient = 'parent',
		status = false,
	) =>
		db.send_to_session_target({
			from_session_id: sender,
			target: recipient,
			body: 'Progress or completion',
			message_type: status ? 'status' : 'action',
		});

	const poller = (recipient: string) =>
		new CoordinationPoller({
			db,
			get_session_id: () => recipient,
			should_auto_inject_messages: () => true,
		});

	return { db, path, group, send, poller };
}

describe('recipient-owned coordination', () => {
	it('recreates the pricing incident: two workers find only their actual parent, not an unrelated same-repo session', async () => {
		const { db, send, poller } = await setup();

		for (const worker of ['writer', 'validator']) {
			expect(
				db.resolve_session_targets('parent', worker)[0].session_id,
			).toBe('parent');
			send(worker, 'parent');
			send(worker, 'pricing');
		}

		db.update_session_agent_name('parent', 'renamed');
		expect(
			db.resolve_session_targets('parent', 'writer')[0].session_id,
		).toBe('parent');

		const pricing = { sendMessage: vi.fn() },
			parent = { sendMessage: vi.fn() };

		poller('pricing').poll(pricing);
		poller('parent').poll(parent);
		expect(pricing.sendMessage).not.toHaveBeenCalled();
		expect(parent.sendMessage).toHaveBeenCalledTimes(1);
		expect(db.list_inbox('pricing')).toHaveLength(2);
		expect(
			db
				.list_inbox('pricing')
				.every(
					(m) => !m.delivered_at && !m.read_at && !m.acknowledged_at,
				),
		).toBe(true);
	});

	it('resolves parent structurally even when another session owns that literal name or id', async () => {
		const { db, group, send } = await setup();
		db.register_session({
			session_id: 'actual-owner',
			cwd: '/other-repo',
		});
		db.add_group_member({
			group_id: group.group_id,
			session_id: 'actual-owner',
		});
		db.register_session({
			session_id: 'writer',
			cwd: '/same-repo',
			parent_session_id: 'actual-owner',
		});
		send('writer', 'parent');
		expect(db.list_inbox('actual-owner')).toHaveLength(1);
		expect(db.list_inbox('parent')).toEqual([]);
	});

	it('does not retroactively enroll unsolicited mail when sessions later collaborate', async () => {
		const { db, group, send } = await setup();
		const old = send('stranger');
		db.add_group_member({
			group_id: group.group_id,
			session_id: 'stranger',
		});
		const fresh = send('stranger');
		expect(
			db.list_auto_inbox('parent').map((m) => m.message_id),
		).toEqual([fresh.message_id]);
		expect(
			db.list_inbox('parent').map((m) => m.message_id),
		).toContain(old.message_id);
	});

	it('sender controls isolate one peer and cannot override a session-wide pause', async () => {
		const { db, send } = await setup();
		db.delivery.set_paused('parent', true, 'sender', 'writer');
		send('writer');
		const other = send('validator');
		expect(
			db
				.list_auto_inbox('parent')
				.map((message) => message.message_id),
		).toEqual([other.message_id]);
		db.delivery.set_paused('parent', true);
		db.delivery.set_paused('parent', false, 'sender', 'writer');
		send('writer');
		expect(db.list_auto_inbox('parent')).toEqual([]);
	});

	it.each(['session', 'sender', 'group'] as const)(
		'persists %s pause across reopen without replaying the suppressed backlog',
		async (scope) => {
			const { db, path, group, send } = await setup();

			const target = {
				sender: 'writer',
				group: group.group_id,
				session: '',
			}[scope];

			send();
			db.delivery.set_paused('parent', true, scope, target);
			send();
			const reopened = await TeamDatabase.open(path);

			try {
				expect(reopened.list_auto_inbox('parent')).toEqual([]);
				expect(reopened.delivery.controls('parent')).toContainEqual({
					scope,
					target,
					paused: 1,
				});
				reopened.delivery.set_paused('parent', false, scope, target);
				expect(reopened.list_auto_inbox('parent')).toEqual([]);
				const fresh = send();
				expect(
					reopened.list_auto_inbox('parent').map((m) => m.message_id),
				).toEqual([fresh.message_id]);
				expect(reopened.list_inbox('parent')).toHaveLength(3);
			} finally {
				reopened.close();
			}
		},
	);

	it('checks queued mail at the final dispatch boundary and never substitutes receipt acknowledgements for suppression', async () => {
		const { db, send, poller } = await setup();
		const pending = send();
		const delivery = poller('parent');
		const pi = { sendMessage: vi.fn() };
		db.delivery.set_paused('parent', true);
		delivery.poll(pi);
		expect(delivery.take_delivery(false)).toBeUndefined();
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(db.list_inbox('parent')[0]).toMatchObject({
			message_id: pending.message_id,
			delivered_at: undefined,
			read_at: undefined,
			acknowledged_at: undefined,
		});
	});

	it('keeps status quiet even within an active collaboration', async () => {
		const { send, poller } = await setup();
		send('writer', 'parent', true);
		const delivery = poller('parent');
		const pi = { sendMessage: vi.fn() };
		delivery.poll(pi);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(delivery.take_delivery(true)).toBeDefined();
	});

	it('leaving suppresses inbound and outbound pending mail even after rejoining', async () => {
		const { db, group, send } = await setup();
		send();
		send('parent', 'writer');
		db.delivery.leave_group(group.group_id, 'writer');
		expect(db.list_auto_inbox('parent')).toEqual([]);
		expect(db.list_auto_inbox('writer')).toEqual([]);
		db.add_group_member({
			group_id: group.group_id,
			session_id: 'writer',
		});
		expect(db.list_auto_inbox('parent')).toEqual([]);
		expect(db.list_auto_inbox('writer')).toEqual([]);
		send();
		expect(db.list_auto_inbox('parent')).toHaveLength(1);
	});

	it('only the owner closes a collaboration; pending and late results remain inspectable but cannot reopen it', async () => {
		const { db, group, send } = await setup();
		send();
		expect(() =>
			db.delivery.close_group(group.group_id, 'writer'),
		).toThrow('owner');
		db.delivery.close_group(group.group_id, 'parent');

		const other = db.create_group({
			name: 'other-task',
			created_by_session_id: 'parent',
		});

		db.add_group_member({
			group_id: other.group_id,
			session_id: 'writer',
		});
		send(); // The old worker's default route stays bound to its original task.
		expect(db.get_group(group.group_id)?.closed_at).toBeTruthy();
		expect(db.list_auto_inbox('parent')).toEqual([]);
		expect(db.list_inbox('parent')).toHaveLength(2);
		expect(() =>
			db.add_group_member({
				group_id: group.group_id,
				session_id: 'writer',
			}),
		).toThrow('closed');
		expect(() =>
			db.send_to_group({
				from_session_id: 'parent',
				target: group.group_id,
				body: 'wake',
			}),
		).toThrow('closed');
	});

	it('invitations cannot turn an unrelated conversation into an automatic recipient', async () => {
		const { db, group, send } = await setup();

		const context = {
			coordination_db: db,
			require_session_id: () => 'parent',
			ctx: { cwd: '/same-repo' },
			notify_coordination_messages: vi.fn(async () => {}),
		};

		await expect(
			execute_coordination_action(
				{ action: 'group_join', team_id: group.group_id },
				{ ...context, require_session_id: () => 'stranger' },
			),
		).rejects.toThrow('invitation');
		await expect(
			execute_coordination_action(
				{
					action: 'group_add_session',
					team_id: group.group_id,
					to: 'pricing',
				},
				{ ...context, require_session_id: () => 'writer' },
			),
		).rejects.toThrow('owner');
		await execute_coordination_action(
			{
				action: 'group_add_session',
				team_id: group.group_id,
				to: 'pricing',
			},
			context,
		);
		send('writer', 'pricing');
		expect(db.list_auto_inbox('pricing')).toEqual([]);
		await execute_coordination_action(
			{ action: 'group_join', team_id: group.group_id },
			{ ...context, require_session_id: () => 'pricing' },
		);
		const fresh = send('writer', 'pricing');
		expect(
			db.list_auto_inbox('pricing').map((m) => m.message_id),
		).toEqual([fresh.message_id]);
	});
});
