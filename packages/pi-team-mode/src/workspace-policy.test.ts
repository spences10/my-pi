import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from './db/index.js';
import { resolve_teammate_workspace } from './workspace-policy.js';

const dirs: string[] = [];

async function setup() {
	const root = mkdtempSync(join(tmpdir(), 'pi-team-workspace-'));
	dirs.push(root);
	return {
		root,
		db: await TeamDatabase.open(join(root, 'coordination.db')),
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('teammate workspace policy', () => {
	it('requires an explicit distinct absolute directory for isolation', async () => {
		const { db, root } = await setup();
		expect(() =>
			resolve_teammate_workspace({
				db,
				lead_cwd: root,
				mode: 'isolated',
				path: root,
			}),
		).toThrow(/must differ/);
		expect(() =>
			resolve_teammate_workspace({
				db,
				lead_cwd: root,
				mode: 'isolated',
				path: 'relative',
			}),
		).toThrow(/absolute path/);
		db.close();
	});

	it('rejects an isolated workspace owned by an active session', async () => {
		const { db, root } = await setup();
		const isolated = mkdtempSync(join(tmpdir(), 'pi-team-isolated-'));
		dirs.push(isolated);
		db.register_session({
			session_id: 'owner',
			cwd: isolated,
			status: 'online',
		});
		expect(() =>
			resolve_teammate_workspace({
				db,
				lead_cwd: root,
				mode: 'isolated',
				path: isolated,
			}),
		).toThrow(/already owned.*owner/);
		db.close();
	});

	it('accepts shared cwd only through explicit shared mode', async () => {
		const { db, root } = await setup();
		expect(
			resolve_teammate_workspace({
				db,
				lead_cwd: root,
				mode: 'shared',
			}),
		).toBe(root);
		db.close();
	});
});
