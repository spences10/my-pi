import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from './db/index.js';
import {
	assert_teammate_spawn_allowed,
	TEAM_MAX_CONCURRENT_CHILDREN_ENV,
	TEAM_MAX_DEPTH_ENV,
} from './spawn-limits.js';

const dirs: string[] = [];
const original_depth = process.env[TEAM_MAX_DEPTH_ENV];
const original_concurrency =
	process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV];

async function database(): Promise<TeamDatabase> {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-spawn-limits-'));
	dirs.push(dir);
	return TeamDatabase.open(join(dir, 'coordination.db'));
}

afterEach(() => {
	if (original_depth === undefined)
		delete process.env[TEAM_MAX_DEPTH_ENV];
	else process.env[TEAM_MAX_DEPTH_ENV] = original_depth;
	if (original_concurrency === undefined)
		delete process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV];
	else
		process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV] =
			original_concurrency;
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('teammate spawn limits', () => {
	it('rejects recursive spawning beyond the configured depth', async () => {
		const db = await database();
		process.env[TEAM_MAX_DEPTH_ENV] = '2';
		db.register_session({ session_id: 'root', cwd: '/repo' });
		db.register_session({
			session_id: 'lead',
			cwd: '/repo',
			parent_session_id: 'root',
		});
		db.register_session({
			session_id: 'nested-lead',
			cwd: '/repo',
			parent_session_id: 'lead',
		});

		expect(() =>
			assert_teammate_spawn_allowed(db, 'lead'),
		).not.toThrow();
		expect(() =>
			assert_teammate_spawn_allowed(db, 'nested-lead'),
		).toThrow('MY_PI_TEAM_MAX_DEPTH=2');
		db.close();
	});

	it('rejects excess active direct children', async () => {
		const db = await database();
		process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV] = '1';
		db.register_session({ session_id: 'lead', cwd: '/repo' });
		db.register_session({
			session_id: 'worker',
			cwd: '/repo',
			parent_session_id: 'lead',
			status: 'online',
		});

		expect(() => assert_teammate_spawn_allowed(db, 'lead')).toThrow(
			'MY_PI_TEAM_MAX_CONCURRENT_CHILDREN=1',
		);
		db.close();
	});

	it('does not count offline children against concurrency', async () => {
		const db = await database();
		process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV] = '1';
		db.register_session({ session_id: 'lead', cwd: '/repo' });
		db.register_session({
			session_id: 'finished-worker',
			cwd: '/repo',
			parent_session_id: 'lead',
			status: 'offline',
		});

		expect(() =>
			assert_teammate_spawn_allowed(db, 'lead'),
		).not.toThrow();
		db.close();
	});
});
