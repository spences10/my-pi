import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { capture_process_identity } from './process-identity.js';
import {
	shutdown_orphaned_member,
	wait_for_orphaned_member,
} from './runner-orchestration.js';
import { TeamStore } from './store.js';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function test_store() {
	const root = mkdtempSync(join(tmpdir(), 'my-pi-orphan-identity-'));
	roots.push(root);
	const store = new TeamStore(root);
	const team = store.create_team({ cwd: '/repo' });
	return { store, team };
}

describe('orphan process identity hardening', () => {
	it('refuses shutdown when a live pid has a different start identity', async () => {
		const child = spawn(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			{ stdio: 'ignore' },
		);
		try {
			const { store, team } = test_store();
			await store.upsert_member(team.id, {
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				pid: child.pid,
				process_identity: child.pid
					? {
							pid: child.pid,
							platform: process.platform,
							captured_at: new Date().toISOString(),
							start_key: 'old-process-start',
						}
					: undefined,
			});
			const killed: NodeJS.Signals[] = [];

			await expect(
				shutdown_orphaned_member(store, team.id, 'alice', 1, {
					is_alive: () => true,
					capture: (pid) => ({
						pid,
						platform: process.platform,
						captured_at: new Date().toISOString(),
						start_key: 'new-process-start',
					}),
					kill: (_pid, signal) => killed.push(signal),
				}),
			).rejects.toThrow(/process start identity changed/);
			expect(killed).toEqual([]);
		} finally {
			if (child.pid) {
				try {
					process.kill(child.pid, 'SIGKILL');
				} catch {
					// Already stopped.
				}
			}
		}
	});

	it('refuses shutdown for the current process even with identity', async () => {
		const { store, team } = test_store();
		await store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'idle',
			pid: process.pid,
			process_identity: capture_process_identity(process.pid),
		});

		await expect(
			shutdown_orphaned_member(store, team.id, 'alice'),
		).rejects.toThrow(/No safe orphaned teammate process/);
	});

	it('refuses shutdown for non-teammate members', async () => {
		const { store, team } = test_store();
		await store.upsert_member(team.id, {
			name: 'lead',
			role: 'lead',
			status: 'idle',
			pid: process.pid,
		});

		await expect(
			shutdown_orphaned_member(store, team.id, 'lead'),
		).rejects.toThrow(/Refusing to terminate non-teammate/);
	});

	it('marks dead persisted processes offline instead of signalling', async () => {
		const { store, team } = test_store();
		await store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'idle',
			pid: 999_999_999,
		});

		const member = await shutdown_orphaned_member(
			store,
			team.id,
			'alice',
		);

		expect(member.status).toBe('offline');
	});

	it('refuses wait when identity cannot verify the pid', async () => {
		const child = spawn(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			{ stdio: 'ignore' },
		);
		try {
			const { store, team } = test_store();
			await store.upsert_member(team.id, {
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				pid: child.pid,
			});

			await expect(
				wait_for_orphaned_member(store, team.id, 'alice', 1, {
					is_alive: () => true,
					capture: () => undefined,
					kill: () => undefined,
				}),
			).rejects.toThrow(/missing persisted process identity/);
		} finally {
			if (child.pid) {
				try {
					process.kill(child.pid, 'SIGKILL');
				} catch {
					// Already stopped.
				}
			}
		}
	});
});
