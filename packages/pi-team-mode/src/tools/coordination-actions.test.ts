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
			const targets = result.content[0]!.text.split('\n')
				.filter((line) => line.startsWith('- '))
				.map((line) => line.slice(2).split(' ')[0]!);

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

			expect(local.details).toMatchObject({
				group: { group_id: group_a.group_id },
			});
			expect(exact.details).toMatchObject({
				group: { group_id: group_b.group_id },
			});
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
				{
					action: 'session_inbox',
					include_read: true,
					include_acknowledged: true,
					mode: 'full',
				},
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
				{
					action: 'session_inbox',
					include_read: true,
					mode: 'full',
				},
				context,
			);

			expect(compact.content[0]?.text).toContain(
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

	it('scopes session history by project and paginates explicit global history', async () => {
		const db = await tmp_db();
		try {
			for (let index = 0; index < 35; index += 1)
				db.register_session({
					session_id: `local-${index}`,
					cwd: '/repo',
				});
			for (let index = 0; index < 5; index += 1)
				db.register_session({
					session_id: `foreign-${index}`,
					cwd: '/other-repo',
				});
			db.register_session({
				session_id: 'local-history',
				cwd: '/repo',
				status: 'offline',
			});
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'local-0',
			};

			const local = await execute_coordination_action(
				{ action: 'session_list' },
				context,
			);
			const local_page = await execute_coordination_action(
				{
					action: 'session_list',
					mode: 'full',
					limit: 5,
					offset: 5,
				},
				context,
			);
			const global_history = await execute_coordination_action(
				{
					action: 'session_list',
					global: true,
					include_offline: true,
					mode: 'full',
					limit: 100,
				},
				context,
			);

			expect(local.details).toMatchObject({
				returned_count: 20,
				total_count: 35,
				has_more: true,
				next_offset: 20,
			});
			expect(local_page.details).toMatchObject({
				returned_count: 5,
				total_count: 35,
				limit: 5,
				offset: 5,
			});
			expect(global_history.details).toMatchObject({
				returned_count: 41,
				total_count: 41,
				has_more: false,
			});
			expect(global_history.content[0]?.text).toContain(
				'Global offline session history',
			);
			expect(local.content[0]?.text).toContain('Next page:');
		} finally {
			db.close();
		}
	});

	it('filters inbox history by sender and receipt state without mode broadening scope', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({
				session_id: 'worker-a',
				cwd: '/repo',
				agent_name: 'alpha',
			});
			db.register_session({
				session_id: 'worker-b',
				cwd: '/repo',
				agent_name: 'beta',
			});
			const unread_a = db.send_to_session_target({
				from_session_id: 'worker-a',
				target: 'lead',
				body: 'unread alpha',
			});
			const read_a = db.send_to_session_target({
				from_session_id: 'worker-a',
				target: 'lead',
				body: 'read alpha',
			});
			const acknowledged_b = db.send_to_session_target({
				from_session_id: 'worker-b',
				target: 'lead',
				body: 'acknowledged beta',
			});
			const unread_b = db.send_to_session_target({
				from_session_id: 'worker-b',
				target: 'lead',
				body: 'unread beta',
			});
			db.mark_messages_read('lead', [read_a.message_id]);
			db.mark_messages_acknowledged('lead', [
				acknowledged_b.message_id,
			]);
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const full_default = await execute_coordination_action(
				{ action: 'session_inbox', mode: 'full' },
				context,
			);
			const beta = await execute_coordination_action(
				{
					action: 'session_inbox',
					from: 'beta',
					include_acknowledged: true,
				},
				context,
			);
			const unacknowledged = await execute_coordination_action(
				{
					action: 'message_list',
					include_read: true,
					unacknowledged_only: true,
				},
				context,
			);
			const broad = await execute_coordination_action(
				{
					action: 'session_inbox',
					include_read: true,
					include_acknowledged: true,
					mode: 'full',
					limit: 2,
				},
				context,
			);

			expect(full_default.details).toMatchObject({
				returned_count: 2,
				total_count: 2,
			});
			expect(full_default.content[0]?.text).toContain(
				unread_a.message_id,
			);
			expect(full_default.content[0]?.text).toContain(
				unread_b.message_id,
			);
			expect(full_default.content[0]?.text).not.toContain(
				read_a.message_id,
			);
			expect(beta.details).toMatchObject({
				returned_count: 2,
				total_count: 2,
			});
			expect(unacknowledged.details).toMatchObject({
				returned_count: 3,
				total_count: 3,
			});
			expect(broad.details).toMatchObject({
				returned_count: 2,
				total_count: 4,
				has_more: true,
			});
			expect(broad.content[0]?.text).toContain(
				'Broad full-history inbox reads are paginated',
			);
		} finally {
			db.close();
		}
	});

	it('bounds byte-heavy output with hundreds of sessions and messages', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			for (let index = 0; index < 240; index += 1)
				db.register_session({
					session_id: `peer-${index.toString().padStart(3, '0')}`,
					cwd: '/repo',
					agent_name: `worker-${index}`,
				});
			for (let index = 0; index < 240; index += 1)
				db.send_to_session_target({
					from_session_id: 'peer-000',
					target: 'lead',
					body: `payload-${index}-${'x'.repeat(800)}`,
				});
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const sessions = await execute_coordination_action(
				{ action: 'session_list', mode: 'full' },
				context,
			);
			const inbox = await execute_coordination_action(
				{ action: 'session_inbox' },
				context,
			);
			const next_messages = await execute_coordination_action(
				{
					action: 'message_list',
					limit: 7,
					offset: 20,
				},
				context,
			);

			expect(sessions.details).toMatchObject({
				returned_count: 20,
				total_count: 241,
				has_more: true,
			});
			expect(inbox.details).toMatchObject({
				returned_count: 20,
				total_count: 240,
				has_more: true,
			});
			expect(next_messages.details).toMatchObject({
				returned_count: 7,
				total_count: 240,
				limit: 7,
				offset: 20,
				next_offset: 27,
			});
			expect(
				Buffer.from(sessions.content[0]?.text ?? '').length,
			).toBeLessThan(16_000);
			expect(
				Buffer.from(inbox.content[0]?.text ?? '').length,
			).toBeLessThan(16_000);
			expect(JSON.stringify(inbox.details)).not.toContain('payload-');
		} finally {
			db.close();
		}
	}, 15_000);

	it('paginates project-scoped group and artifact lists with global opt-in', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			for (let index = 0; index < 25; index += 1) {
				db.create_group({
					name: `local-group-${index}`,
					cwd: '/repo',
					created_by_session_id: 'lead',
				});
				db.create_artifact({
					kind: 'summary',
					owner_session_id: 'lead',
					cwd: '/repo',
					title: `local-artifact-${index}`,
					summary: 'summary',
					body: 'body',
				});
			}
			for (let index = 0; index < 3; index += 1) {
				db.create_group({
					name: `foreign-group-${index}`,
					cwd: '/other-repo',
				});
				db.create_artifact({
					kind: 'summary',
					owner_session_id: 'lead',
					cwd: '/other-repo',
					title: `foreign-artifact-${index}`,
					summary: 'summary',
					body: 'body',
				});
			}
			const context = {
				ctx: { cwd: '/repo' },
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const groups = await execute_coordination_action(
				{ action: 'group_list', limit: 5, offset: 5 },
				context,
			);
			const global_groups = await execute_coordination_action(
				{ action: 'group_list', global: true, limit: 100 },
				context,
			);
			const artifacts = await execute_coordination_action(
				{ action: 'artifact_list', limit: 5, offset: 5 },
				context,
			);
			const global_artifacts = await execute_coordination_action(
				{ action: 'artifact_list', global: true, limit: 100 },
				context,
			);

			expect(groups.details).toMatchObject({
				returned_count: 5,
				total_count: 25,
				limit: 5,
				offset: 5,
			});
			expect(global_groups.details).toMatchObject({
				returned_count: 28,
				total_count: 28,
			});
			expect(artifacts.details).toMatchObject({
				returned_count: 5,
				total_count: 25,
			});
			expect(global_artifacts.details).toMatchObject({
				returned_count: 28,
				total_count: 28,
			});
		} finally {
			db.close();
		}
	});
});
