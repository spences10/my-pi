import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamDatabase } from '../db/index.js';
import { execute_coordination_action } from './coordination-actions.js';

const dirs: string[] = [];

async function tmp_db(): Promise<TeamDatabase> {
	const dir = mkdtempSync(
		join(tmpdir(), 'pi-team-coordination-actions-'),
	);
	dirs.push(dir);
	return TeamDatabase.open(join(dir, 'coordination.db'));
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('coordination actions', () => {
	it('queues and notifies peer messages without writing another session file', async () => {
		const db = await tmp_db();
		try {
			const target_file = join(dirs[0]!, 'peer.jsonl');
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({
				session_id: 'peer',
				session_file: target_file,
				cwd: '/repo',
			});
			const notify = vi.fn(async () => undefined);

			const result = await execute_coordination_action(
				{
					action: 'session_send',
					to: 'peer',
					message: 'peer-only hello',
				},
				{
					ctx: { cwd: '/repo' } as never,
					coordination_db: db,
					notify_coordination_messages: notify,
					require_session_id: () => 'lead',
				},
			);

			const message = db.list_inbox('peer')[0]!;
			expect(message.body).toBe('peer-only hello');
			expect(message.delivered_at).toBeUndefined();
			expect(existsSync(target_file)).toBe(false);
			expect(notify).toHaveBeenCalledWith(
				['peer'],
				message.message_id,
			);
			expect(result.details).toEqual({
				message: expect.objectContaining({
					message_id: message.message_id,
				}),
			});
		} finally {
			db.close();
		}
	});

	it('lists directly copyable targets that remain unambiguous after compact-prefix collisions', async () => {
		const db = await tmp_db();
		try {
			const first_id = '019f0f71-967e-7aed-853c-94ac29fbe7b6';
			const second_id = '019f0f71-967f-7aed-853c-94ac29fbe7b6';
			const hidden_collision = '019f0f71-967eX7aed-853c-94ac29fbe7b6';
			db.register_session({ session_id: first_id, cwd: '/repo' });
			db.register_session({ session_id: second_id, cwd: '/repo' });
			db.register_session({
				session_id: hidden_collision,
				cwd: '/repo',
			});
			db.mark_session_status(hidden_collision, 'offline');

			const result = await execute_coordination_action(
				{ action: 'session_list' },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => first_id,
				},
			);
			const targets = result.content[0]!.text.split('\n').map(
				(line) => line.slice(2).split(' ')[0]!,
			);

			expect(targets).toHaveLength(2);
			expect(targets[0]).not.toBe(targets[1]);
			expect(result.content[0]!.text).toContain(
				first_id.slice(0, 14),
			);
			expect(result.content[0]!.text).not.toContain('…');
			for (const target of targets)
				expect(db.resolve_session_targets(target)).toHaveLength(1);
		} finally {
			db.close();
		}
	});

	it('scopes group names to the caller cwd while exact ids remain global', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead-a', cwd: '/repo-a' });
			db.register_session({ session_id: 'lead-b', cwd: '/repo-b' });
			const group_a = db.create_group({
				name: 'review',
				cwd: '/repo-a',
				created_by_session_id: 'lead-a',
			});
			const group_b = db.create_group({
				name: 'review',
				cwd: '/repo-b',
				created_by_session_id: 'lead-b',
			});
			const context = {
				ctx: { cwd: '/repo-a' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead-a',
			};

			const local = await execute_coordination_action(
				{ action: 'group_join', name: 'review' },
				context,
			);
			const exact = await execute_coordination_action(
				{ action: 'group_join', team_id: group_b.group_id },
				context,
			);

			expect(local.details.group?.group_id).toBe(group_a.group_id);
			expect(exact.details.group?.group_id).toBe(group_b.group_id);
			await expect(
				execute_coordination_action(
					{ action: 'group_join', name: 'review' },
					{ ...context, ctx: { cwd: '/repo-c' } },
				),
			).rejects.toThrow('Unknown coordination group');
		} finally {
			db.close();
		}
	});

	it('rejects unregistered and foreign send-side identities', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'victim', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			await expect(
				execute_coordination_action(
					{
						action: 'session_send',
						from: 'not-a-session',
						to: 'worker',
						message: 'Please report.',
					},
					context,
				),
			).rejects.toThrow(/bound to the current session/);
			await expect(
				execute_coordination_action(
					{
						action: 'session_send',
						from: 'victim',
						to: 'worker',
						message: 'Please report.',
					},
					context,
				),
			).rejects.toThrow(/sender spoofing/);
			expect(db.list_inbox('worker')).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('resolves sender aliases for session sends', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: 'lead-session',
				cwd: '/repo',
				agent_name: 'lead',
			});
			db.register_session({ session_id: 'worker', cwd: '/repo' });

			await execute_coordination_action(
				{
					action: 'session_send',
					from: 'lead',
					to: 'worker',
					message: 'Please report.',
				},
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead-session',
				},
			);

			expect(db.list_inbox('worker')[0]).toMatchObject({
				from_session_id: 'lead-session',
			});
		} finally {
			db.close();
		}
	});

	it('waits on the current inbox even when a foreign to is supplied', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'worker result',
			});
			db.send_to_session_target({
				from_session_id: 'lead',
				target: 'parent',
				body: 'lead result',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', to: 'lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).toContain('lead result');
			expect(result.content[0]?.text).not.toContain('worker result');
		} finally {
			db.close();
		}
	});

	it('resolves session_wait from aliases before filtering senders', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({
				session_id: 'lead-session',
				cwd: '/repo',
				agent_name: 'tree-lead',
			});
			db.send_to_session_target({
				from_session_id: 'lead-session',
				target: 'parent',
				body: 'lead result',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', from: 'tree-lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).toContain('lead result');
		} finally {
			db.close();
		}
	});

	it('does not let message_wait select another inbox', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'worker result',
			});

			const result = await execute_coordination_action(
				{ action: 'message_wait', to: 'lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).not.toContain('worker result');
			expect(result.content[0]?.text).toContain(
				'No matching inbox messages.',
			);
		} finally {
			db.close();
		}
	});

	it('marks waited messages read so auto-injection does not repeat them', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'pong',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toContain('pong');
			expect(
				db.list_inbox('lead', {
					undelivered_only: true,
					include_read: true,
				}),
			).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('limits read and ack output to requested message ids', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const first = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'first',
			});
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'second',
			});

			const result = await execute_coordination_action(
				{
					action: 'session_ack',
					message_ids: [first.message_id],
				},
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toContain(
				`Acknowledged 1 coordination message: ${first.message_id}`,
			);
			expect(result.content[0]?.text).not.toContain('first');
			expect(result.content[0]?.text).not.toContain('second');
		} finally {
			db.close();
		}
	});

	it('does not echo message bodies in read confirmations', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: `please inspect ${'private context '.repeat(40)}final detail`,
			});

			const result = await execute_coordination_action(
				{ action: 'session_read' },
				{
					ctx: { cwd: '/repo' },
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toBe(
				`Marked 1 coordination message read: ${message.message_id}`,
			);
			expect(result.content[0]?.text).not.toContain(
				'private context',
			);
			expect(result.content[0]?.text).not.toContain('[truncated]');
		} finally {
			db.close();
		}
	});

	it('does not show acknowledged messages in default or include_read inbox output', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'Acknowledged — teammate session is ready.',
			});
			db.mark_messages_delivered('lead', [message.message_id]);
			db.mark_messages_read('lead', [message.message_id]);
			db.mark_messages_acknowledged('lead', [message.message_id]);
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const compact = await execute_coordination_action(
				{ action: 'session_inbox', include_read: true },
				context,
			);
			const full = await execute_coordination_action(
				{ action: 'session_inbox', include_read: true, mode: 'full' },
				context,
			);

			expect(compact.content[0]?.text).not.toContain(
				'Acknowledged — teammate session is ready.',
			);
			expect(full.content[0]?.text).toContain(
				'Acknowledged — teammate session is ready.',
			);
		} finally {
			db.close();
		}
	});

	it('uses compact session inbox output unless mode is full', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `please inspect ${'private context '.repeat(40)}final detail`,
			});

			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'worker',
			};
			const compact = await execute_coordination_action(
				{ action: 'session_inbox' },
				context,
			);
			const full = await execute_coordination_action(
				{ action: 'session_inbox', mode: 'full' },
				context,
			);

			expect(compact.content[0]?.text).toContain('[truncated]');
			expect(compact.content[0]?.text).toContain('body_length:');
			expect(compact.content[0]?.text).toContain('chunk_count:');
			expect(compact.content[0]?.text).not.toContain('final detail');
			expect(JSON.stringify(compact.details)).not.toContain(
				'private context',
			);
			expect(full.content[0]?.text).toContain('final detail');
		} finally {
			db.close();
		}
	});

	it('retrieves full text for automatically delivered read messages with mode full', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `automatic preview ${'mailbox context '.repeat(40)}final detail`,
			});
			db.mark_messages_delivered('worker', [message.message_id]);
			db.mark_messages_read('worker', [message.message_id]);
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'worker',
			};

			const compact = await execute_coordination_action(
				{ action: 'session_inbox' },
				context,
			);
			const full = await execute_coordination_action(
				{ action: 'session_inbox', mode: 'full' },
				context,
			);

			expect(compact.content[0]?.text).toBe(
				'No matching inbox messages.',
			);
			expect(full.content[0]?.text).toContain('final detail');
		} finally {
			db.close();
		}
	});

	it('retrieves focused session message chunks with bounds', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `${'first '.repeat(260)}${'second '.repeat(260)}${'third '.repeat(260)}`,
			});
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'worker',
			};

			const chunk = await execute_coordination_action(
				{
					action: 'session_inbox',
					message_id: message.message_id,
					chunk_index: 1,
				},
				context,
			);
			const range = await execute_coordination_action(
				{
					action: 'session_inbox',
					message_id: message.message_id,
					chunk_index: 1,
					before: 1,
					after: 1,
				},
				context,
			);

			expect(chunk.content[0]?.text).toContain('chunk 2/');
			expect(chunk.content[0]?.text).not.toContain('chunk 1/');
			expect(range.content[0]?.text).toContain('chunk 1/');
			expect(range.content[0]?.text).toContain('chunk 2/');
			expect(range.content[0]?.text).toContain('chunk 3/');
		} finally {
			db.close();
		}
	});

	it('lists artifact chunk metadata and retrieves chunks or full body', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const artifact = db.create_artifact({
				kind: 'handoff',
				owner_session_id: 'lead',
				cwd: '/repo',
				title: 'handoff',
				summary: 'summary',
				body: `${'a'.repeat(1200)}${'b'.repeat(1200)}final detail`,
			});
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const list = await execute_coordination_action(
				{ action: 'artifact_list' },
				context,
			);
			const chunk = await execute_coordination_action(
				{
					action: 'artifact_get',
					artifact_id: artifact.artifact_id,
					chunk_index: 1,
				},
				context,
			);
			const full = await execute_coordination_action(
				{
					action: 'artifact_get',
					artifact_id: artifact.artifact_id,
					mode: 'full',
				},
				context,
			);

			expect(list.content[0]?.text).toContain('chunk_count:');
			expect(chunk.content[0]?.text).toContain('chunk 2/');
			expect(chunk.content[0]?.text).toContain('bbb');
			expect(chunk.content[0]?.text).not.toContain('final detail');
			expect(full.content[0]?.text).toContain('final detail');
		} finally {
			db.close();
		}
	});
});
