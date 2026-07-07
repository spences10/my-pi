import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
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
	it('prints full session ids when session_list mode is full', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: '019f0f71-967e-7aed-853c-94ac29fbe7b6',
				cwd: '/repo',
			});

			const result = await execute_coordination_action(
				{ action: 'session_list', mode: 'full' },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () =>
						'019f0f71-967e-7aed-853c-94ac29fbe7b6',
				},
			);

			expect(result.content[0]?.text).toContain(
				'019f0f71-967e-7aed-853c-94ac29fbe7b6',
			);
		} finally {
			db.close();
		}
	});

	it('creates visible resumable teammate sessions', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
				role: 'lead',
			});

			const wake_visible_teammate_session = vi.fn(
				async () => undefined,
			);
			const result = await execute_coordination_action(
				{
					action: 'member_spawn',
					name: 'teammate-a',
					message: 'Inspect the failing test.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
					wake_visible_teammate_session,
				},
			);

			const teammate = result.details.teammate as {
				session_id: string;
				session_file: string;
			};
			expect(db.get_session(teammate.session_id)).toMatchObject({
				agent_name: 'teammate-a',
				role: 'teammate',
				status: 'offline',
				availability: 'standby',
				parent_session_id: lead.getSessionId(),
			});
			expect(existsSync(teammate.session_file)).toBe(true);
			expect(readFileSync(teammate.session_file, 'utf8')).toContain(
				'Inspect the failing test.',
			);
			expect(wake_visible_teammate_session).toHaveBeenCalledWith({
				session_file: teammate.session_file,
				cwd: '/repo',
				message: 'Inspect the failing test.',
				from_session_id: lead.getSessionId(),
				member: 'teammate-a',
				timeout_ms: undefined,
			});
			expect(result.content[0]?.text).toContain(
				'started background task execution',
			);
		} finally {
			db.close();
		}
	});

	it('does not create unflushed live target session files on send', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			const worker = SessionManager.create('/repo', session_dir);
			worker.appendMessage({
				role: 'user',
				content: 'starting',
				timestamp: Date.now(),
			});
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
			});
			db.register_session({
				session_id: worker.getSessionId(),
				session_file: worker.getSessionFile(),
				cwd: '/repo',
				agent_name: 'worker',
			});

			await execute_coordination_action(
				{
					action: 'session_send',
					to: 'worker',
					message: 'Please produce the report.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
				},
			);

			expect(existsSync(worker.getSessionFile()!)).toBe(false);
			expect(() =>
				worker.appendMessage({
					role: 'assistant',
					content: [{ type: 'text', text: 'ok' }],
				} as any),
			).not.toThrow();
		} finally {
			db.close();
		}
	});

	it('writes session sends into existing target session history', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			const worker = SessionManager.create('/repo', session_dir);
			worker.appendMessage({
				role: 'assistant',
				content: [{ type: 'text', text: 'ready' }],
			} as any);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
			});
			db.register_session({
				session_id: worker.getSessionId(),
				session_file: worker.getSessionFile(),
				cwd: '/repo',
				agent_name: 'worker',
			});

			await execute_coordination_action(
				{
					action: 'session_send',
					to: 'worker',
					message: 'Please produce the report.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
				},
			);

			expect(
				readFileSync(worker.getSessionFile()!, 'utf8'),
			).toContain('Please produce the report.');
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
					ctx: { cwd: '/repo' } as any,
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
					ctx: { cwd: '/repo' } as any,
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
					ctx: { cwd: '/repo' } as any,
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
				ctx: { cwd: '/repo' } as any,
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

	it('starts background delivery for offline visible teammates', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({
				session_id: 'worker',
				cwd: '/repo',
				agent_name: 'worker',
				status: 'offline',
				metadata: { created_by: 'team_mode_visible_session' },
			});

			const result = await execute_coordination_action(
				{ action: 'session_send', to: 'worker', message: 'Ping.' },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			const inbox = db.list_inbox('worker', {
				undelivered_only: true,
				include_read: true,
			});
			expect(result.content[0]?.text).toContain(
				'Started background delivery for 1 offline visible teammate',
			);
			expect(inbox).toEqual([]);
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
				ctx: { cwd: '/repo' } as any,
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
				ctx: { cwd: '/repo' } as any,
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
				ctx: { cwd: '/repo' } as any,
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
