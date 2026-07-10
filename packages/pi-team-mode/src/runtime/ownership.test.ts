import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from '../db/index.js';
import type { ProcessIdentityVerifier } from '../process-identity.js';
import {
	adopt_runtime_ownership,
	reserve_runtime_ownership,
	RuntimeOwnershipError,
	transition_runtime,
} from './ownership.js';

const dirs: string[] = [];
const verifier: ProcessIdentityVerifier = {
	capture: (pid) => ({
		pid,
		platform: 'linux',
		captured_at: new Date(0).toISOString(),
		start_key: `start:${pid}`,
	}),
	is_alive: () => true,
	kill: () => undefined,
};

async function database(): Promise<TeamDatabase> {
	const dir = mkdtempSync(join(tmpdir(), 'pi-runtime-'));
	dirs.push(dir);
	mkdirSync(dir, { recursive: true });
	const db = await TeamDatabase.open(join(dir, 'coordination.db'));
	db.register_session({ session_id: 'session', cwd: dir });
	return db;
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('persistent runtime ownership', () => {
	it('atomically rejects a second owner while the lease is active', async () => {
		const db = await database();
		try {
			reserve_runtime_ownership(
				db,
				{
					session_id: 'session',
					runtime_id: 'first',
					endpoint: '/tmp/first.sock',
					now_ms: 1_000,
					lease_ms: 1_000,
				},
				verifier,
			);
			expect(() =>
				reserve_runtime_ownership(
					db,
					{
						session_id: 'session',
						runtime_id: 'second',
						endpoint: '/tmp/second.sock',
						now_ms: 1_500,
					},
					verifier,
				),
			).toThrow(RuntimeOwnershipError);
			expect(db.get_session_runtime('session')?.runtime_id).toBe(
				'first',
			);
		} finally {
			db.close();
		}
	});

	it('increments generation only after an expired owner is proven dead', async () => {
		const db = await database();
		try {
			reserve_runtime_ownership(
				db,
				{
					session_id: 'session',
					runtime_id: 'first',
					endpoint: '/tmp/first.sock',
					now_ms: 1_000,
					lease_ms: 100,
				},
				verifier,
			);
			const dead_verifier = { ...verifier, is_alive: () => false };
			const recovered = reserve_runtime_ownership(
				db,
				{
					session_id: 'session',
					runtime_id: 'second',
					endpoint: '/tmp/second.sock',
					now_ms: 1_200,
				},
				dead_verifier,
			);
			expect(recovered).toMatchObject({
				runtime_id: 'second',
				generation: 2,
			});
		} finally {
			db.close();
		}
	});

	it('guards lifecycle transitions by runtime generation and process identity', async () => {
		const db = await database();
		try {
			const reserved = reserve_runtime_ownership(
				db,
				{
					session_id: 'session',
					runtime_id: 'owner',
					endpoint: '/tmp/owner.sock',
				},
				verifier,
			);
			adopt_runtime_ownership(
				db,
				{
					session_id: 'session',
					runtime_id: 'owner',
					generation: reserved.generation,
					endpoint: '/tmp/owner.sock',
					pid: 42,
				},
				verifier,
			);
			const ready = transition_runtime(db, {
				session_id: 'session',
				runtime_id: 'owner',
				generation: reserved.generation,
				state: 'ready',
				now_ms: 1_000,
			});
			transition_runtime(db, {
				session_id: 'session',
				runtime_id: 'owner',
				generation: reserved.generation,
				state: 'running',
				now_ms: 2_000,
			});
			const idle = transition_runtime(db, {
				session_id: 'session',
				runtime_id: 'owner',
				generation: reserved.generation,
				state: 'idle',
				now_ms: 3_000,
			});
			expect(idle.ready_at).toBe(ready.ready_at);
			expect(() =>
				transition_runtime(db, {
					session_id: 'session',
					runtime_id: 'owner',
					generation: reserved.generation,
					state: 'created',
				}),
			).toThrow('Invalid runtime state transition');
			expect(
				db.list_runtime_events('session').map((event) => event.state),
			).toEqual(['created', 'starting', 'ready', 'running', 'idle']);
		} finally {
			db.close();
		}
	});
});
