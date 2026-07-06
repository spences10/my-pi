import { mkdtempSync, rmSync } from 'node:fs';
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

	it.each([
		['session_read', 'Read'],
		['session_ack', 'Acknowledged'],
	] as const)(
		'marks messages with %s without echoing bodies',
		async (action, verb) => {
			const db = await tmp_db();
			try {
				db.register_session({ session_id: 'lead', cwd: '/repo' });
				db.register_session({ session_id: 'worker', cwd: '/repo' });
				db.send_to_session_target({
					from_session_id: 'lead',
					target: 'worker',
					body: `please inspect ${'private context '.repeat(40)}final detail`,
				});

				const result = await execute_coordination_action(
					{ action },
					{
						ctx: { cwd: '/repo' } as any,
						coordination_db: db,
						notify_coordination_messages: async () => undefined,
						require_session_id: () => 'worker',
					},
				);

				expect(result.content[0]?.text).toBe(
					`${verb} 1 message for worker.`,
				);
				expect(result.content[0]?.text).not.toContain('final detail');
				expect(JSON.stringify(result.details)).not.toContain(
					'private context',
				);
			} finally {
				db.close();
			}
		},
	);

	it('marks only the requested singular message id', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const first = db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: 'first',
			});
			const second = db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: 'second',
			});

			const result = await execute_coordination_action(
				{
					action: 'message_ack',
					to: 'worker',
					message_id: first.message_id,
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'worker',
				},
			);

			const inbox = db.list_inbox('worker', {
				include_acknowledged: true,
			});
			expect(result.details.message_ids).toEqual([first.message_id]);
			expect(
				inbox.find(
					(message) => message.message_id === first.message_id,
				)?.acknowledged_at,
			).toBeTruthy();
			expect(
				inbox.find(
					(message) => message.message_id === second.message_id,
				)?.acknowledged_at,
			).toBeUndefined();
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

	it('opens a headless session and sends initial handoff', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const notify = vi.fn(async () => undefined);
			const headless_runner = {
				open_or_resume: vi.fn(async () => ({
					resumed: false,
					session: db.register_session({
						session_id: 'worker-session',
						cwd: '/repo',
						parent_session_id: 'lead',
						session_alias: 'worker',
					}),
				})),
			};

			const result = await execute_coordination_action(
				{
					action: 'session_open',
					member: 'worker',
					message: 'please research',
					timeout_ms: 1234,
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: notify,
					require_session_id: () => 'lead',
					headless_runner,
					headless_defaults: {
						team_root: '/teams',
						coordination_db_path: '/coordination.db',
						extension_path: '/ext.js',
					},
				},
			);

			expect(headless_runner.open_or_resume).toHaveBeenCalledWith(
				expect.objectContaining({
					alias: 'worker',
					parent_session_id: 'lead',
					message: 'please research',
					timeout_ms: 1234,
				}),
			);
			expect(notify).toHaveBeenCalledWith(
				['worker-session'],
				expect.stringMatching(/^mr/),
			);
			expect(result.content[0]?.text).toContain(
				'Opened headless session',
			);
			expect(db.list_inbox('worker-session')[0]?.body).toBe(
				'please research',
			);
		} finally {
			db.close();
		}
	});

	it.each([
		{ label: 'without a group', team_id: undefined },
		{ label: 'with a group', team_id: 'group' },
	])(
		'opens a headless session using name as alias compatibility $label',
		async ({ team_id }) => {
			const db = await tmp_db();
			try {
				db.register_session({ session_id: 'lead', cwd: '/repo' });
				const group = team_id
					? db.create_group({
							name: 'group',
							cwd: '/repo',
							created_by_session_id: 'lead',
						})
					: undefined;
				const headless_runner = {
					open_or_resume: vi.fn(async () => ({
						resumed: false,
						session: db.register_session({
							session_id: 'worker-session',
							cwd: '/repo',
							parent_session_id: 'lead',
							session_alias: 'worker',
						}),
					})),
				};

				await execute_coordination_action(
					{
						action: 'session_open',
						name: 'worker',
						team_id: group?.group_id,
					},
					{
						ctx: { cwd: '/repo' } as any,
						coordination_db: db,
						notify_coordination_messages: async () => undefined,
						require_session_id: () => 'lead',
						headless_runner,
						headless_defaults: {
							team_root: '/teams',
							coordination_db_path: '/coordination.db',
							extension_path: '/ext.js',
						},
					},
				);

				expect(headless_runner.open_or_resume).toHaveBeenCalledWith(
					expect.objectContaining({
						alias: 'worker',
						group_id: group?.group_id,
					}),
				);
				if (group) {
					expect(
						db
							.list_group_members(group.group_id)
							.map((member) => member.session_id),
					).toContain('worker-session');
				}
			} finally {
				db.close();
			}
		},
	);

	it('opens a headless session into a group before handoff', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const group = db.create_group({
				name: 'research',
				cwd: '/repo',
				created_by_session_id: 'lead',
			});
			const notify = vi.fn(async () => undefined);
			const headless_runner = {
				open_or_resume: vi.fn(async () => ({
					resumed: false,
					session: db.register_session({
						session_id: 'worker-session',
						cwd: '/repo',
						parent_session_id: 'lead',
						session_alias: 'worker',
					}),
				})),
			};

			await execute_coordination_action(
				{
					action: 'session_open',
					member: 'worker',
					team_id: group.group_id,
					message: 'group task',
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: notify,
					require_session_id: () => 'lead',
					headless_runner,
					headless_defaults: {
						team_root: '/teams',
						coordination_db_path: '/coordination.db',
						extension_path: '/ext.js',
					},
				},
			);

			expect(
				db
					.list_group_members(group.group_id)
					.map((member) => member.session_id),
			).toContain('worker-session');
			expect(db.list_inbox('worker-session')).toHaveLength(2);
			expect(notify).toHaveBeenCalledTimes(2);
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
