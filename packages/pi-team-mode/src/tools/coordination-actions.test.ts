import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
