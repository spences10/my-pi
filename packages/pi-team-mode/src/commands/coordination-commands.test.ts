import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamDatabase } from '../db/index.js';
import {
	handle_group_command,
	handle_session_command,
} from './coordination-commands.js';
import type { TeamCommandDeps } from './types.js';

const dirs: string[] = [];

async function tmp_db(): Promise<TeamDatabase> {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-command-actions-'));
	dirs.push(dir);
	return TeamDatabase.open(join(dir, 'coordination.db'));
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('coordination commands', () => {
	it('opens a headless session from slash command', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const notifications: string[] = [];
			const notify_messages = vi.fn(async () => undefined);
			const headless_runner = {
				open_or_resume: vi.fn(async () => ({
					resumed: false,
					session: db.register_session({
						session_id: 'worker-session',
						cwd: '/repo',
					}),
				})),
			};
			const deps = {
				args: '',
				ctx: {
					cwd: '/repo',
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				coordination_db: db,
				notify_coordination_messages: notify_messages,
				get_session_id: () => 'lead',
				handle_team_command: async () => undefined,
				headless_runner,
				headless_defaults: {
					team_root: '/teams',
					coordination_db_path: '/coordination.db',
					extension_path: '/ext.js',
				},
			} as TeamCommandDeps;

			await handle_session_command(deps, [
				'open',
				'worker',
				'please',
				'help',
			]);

			expect(headless_runner.open_or_resume).toHaveBeenCalledWith(
				expect.objectContaining({
					alias: 'worker',
					message: 'please help',
				}),
			);
			expect(notify_messages).toHaveBeenCalledOnce();
			expect(notifications[0]).toContain(
				'Opened session worker-session',
			);
		} finally {
			db.close();
		}
	});

	it('opens a headless session into a group from slash command', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const group = db.create_group({
				name: 'research',
				cwd: '/repo',
				created_by_session_id: 'lead',
			});
			const notifications: string[] = [];
			const notify_messages = vi.fn(async () => undefined);
			const headless_runner = {
				open_or_resume: vi.fn(async () => ({
					resumed: false,
					session: db.register_session({
						session_id: 'worker-session',
						cwd: '/repo',
					}),
				})),
			};
			const deps = {
				args: '',
				ctx: {
					cwd: '/repo',
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				coordination_db: db,
				notify_coordination_messages: notify_messages,
				get_session_id: () => 'lead',
				handle_team_command: async () => undefined,
				headless_runner,
				headless_defaults: {
					team_root: '/teams',
					coordination_db_path: '/coordination.db',
					extension_path: '/ext.js',
				},
			} as TeamCommandDeps;

			await handle_group_command(deps, [
				'open',
				group.group_id,
				'worker',
				'task',
			]);

			expect(
				db
					.list_group_members(group.group_id)
					.map((member) => member.session_id),
			).toContain('worker-session');
			expect(notify_messages).toHaveBeenCalledTimes(2);
			expect(notifications[0]).toContain('in research');
		} finally {
			db.close();
		}
	});

	it('uses compact session inbox output unless --full is passed', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `please inspect ${'private context '.repeat(40)}final detail`,
			});
			const notifications: string[] = [];
			const deps = {
				ctx: {
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				coordination_db: db,
				get_session_id: () => 'worker',
			} as TeamCommandDeps;

			await handle_session_command(deps, ['inbox']);
			await handle_session_command(deps, ['inbox', '--full']);

			expect(notifications[0]).toContain('[truncated]');
			expect(notifications[0]).not.toContain('final detail');
			expect(notifications[1]).toContain('final detail');
		} finally {
			db.close();
		}
	});
});
