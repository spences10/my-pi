import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from '../db/index.js';
import { handle_session_command } from './coordination-commands.js';
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
