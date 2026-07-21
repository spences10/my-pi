import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamDatabase } from './index.js';
import { MIGRATIONS } from './schema.js';

const busy_error = Object.assign(new Error('database is locked'), {
	code: 'ERR_SQLITE_ERROR',
	errcode: 5,
	errstr: 'database is locked',
});

const dirs: string[] = [];

function tmp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-db-'));
	dirs.push(dir);
	return join(dir, 'nested', 'coordination.db');
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('TeamDatabase coordination store', () => {
	it('retries transient busy errors for coordination writes', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			const run = vi
				.fn()
				.mockImplementationOnce(() => {
					throw busy_error;
				})
				.mockReturnValue({ changes: 1 });
			(
				db as unknown as {
					statements: { mark_session_status: { run: typeof run } };
				}
			).statements.mark_session_status = { run };

			expect(() =>
				db.mark_session_status('session-1', 'online'),
			).not.toThrow();
			expect(run).toHaveBeenCalledTimes(2);
		} finally {
			db.close();
		}
	});

	it('creates parent directories, applies pragmas, and migrates schema version', async () => {
		const db_path = tmp_db();
		const db = await TeamDatabase.open(db_path);
		try {
			expect(existsSync(db_path)).toBe(true);
			expect(db.get_schema_version()).toBe(4);
			expect(
				db.read_rows<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_receipts'",
				),
			).toEqual([{ name: 'message_receipts' }]);
			expect(
				db.read_rows<{ journal_mode: string }>('PRAGMA journal_mode'),
			).toEqual([{ journal_mode: 'wal' }]);
			expect(
				db.read_rows<{ foreign_keys: number }>('PRAGMA foreign_keys'),
			).toEqual([{ foreign_keys: 1 }]);
			expect(
				db.read_rows<{ timeout: number }>('PRAGMA busy_timeout'),
			).toEqual([{ timeout: 5000 }]);
		} finally {
			db.close();
		}
	});

	it('additively migrates v3 databases with persistent runtime tables', async () => {
		const db_path = tmp_db();
		mkdirSync(join(db_path, '..'), { recursive: true });
		const { DatabaseSync } = await import('node:sqlite');
		const v3_db = new DatabaseSync(db_path);
		try {
			for (const migration of MIGRATIONS.slice(0, 3))
				v3_db.exec(migration.sql);
			v3_db.exec('PRAGMA user_version = 3;');
		} finally {
			v3_db.close();
		}
		const db = await TeamDatabase.open(db_path);
		try {
			expect(db.get_schema_version()).toBe(4);
			expect(
				db.read_rows<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session_runtimes', 'runtime_events') ORDER BY name",
				),
			).toEqual([
				{ name: 'runtime_events' },
				{ name: 'session_runtimes' },
			]);
		} finally {
			db.close();
		}
	});

	it('migrates existing v1 coordination databases to thinking-level schema', async () => {
		const db_path = tmp_db();
		mkdirSync(join(db_path, '..'), { recursive: true });
		const { DatabaseSync } = await import('node:sqlite');
		const v1_db = new DatabaseSync(db_path);
		try {
			v1_db.exec(MIGRATIONS[0]!.sql);
			v1_db.exec('PRAGMA user_version = 1;');
		} finally {
			v1_db.close();
		}

		const db = await TeamDatabase.open(db_path);
		try {
			expect(db.get_schema_version()).toBe(4);
			expect(
				db.read_rows<{ name: string }>(
					"SELECT name FROM pragma_table_info('sessions') WHERE name IN ('thinking_level', 'availability') ORDER BY name",
				),
			).toEqual([
				{ name: 'availability' },
				{ name: 'thinking_level' },
			]);
		} finally {
			db.close();
		}
	});

	it('registers sessions and sends direct peer messages with receipt state', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 's1',
				cwd: '/repo-a',
				agent_name: 'alpha',
				pid: 1,
				model_id: 'model-a',
				thinking_level: 'high',
				availability: 'standby',
				intent: 'reviewer',
				session_alias: 'alpha-review',
			});
			db.register_session({
				session_id: 's2',
				cwd: '/repo-b',
				agent_name: 'beta',
				pid: 2,
			});

			const message = db.send_to_session_target({
				from_session_id: 's1',
				target: 'beta',
				body: 'cross-project hello',
				requires_ack: true,
			});

			expect(db.get_session('s1')).toMatchObject({
				thinking_level: 'high',
				availability: 'standby',
				intent: 'reviewer',
				session_alias: 'alpha-review',
			});
			expect(db.list_sessions()).toHaveLength(2);
			expect(db.resolve_session_targets('beta')).toHaveLength(1);
			expect(db.resolve_session_targets('s2')).toMatchObject([
				{ session_id: 's2' },
			]);
			expect(db.list_inbox('s2')).toMatchObject([
				{
					message_id: message.message_id,
					body: 'cross-project hello',
					from_session_id: 's1',
					to_session_id: 's2',
					requires_ack: true,
				},
			]);

			db.mark_messages_delivered('s2', [message.message_id]);
			db.mark_messages_read('s2', [message.message_id]);
			db.mark_messages_acknowledged('s2', [message.message_id]);
			expect(
				db.list_inbox('s2', {
					include_read: true,
					include_acknowledged: true,
				})[0],
			).toMatchObject({
				delivered_at: expect.any(String),
				read_at: expect.any(String),
				acknowledged_at: expect.any(String),
			});
		} finally {
			db.close();
		}
	});

	it('updates and clears a live session name used for peer targeting', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 'worker',
				cwd: '/repo',
				agent_name: 'before',
			});

			db.update_session_agent_name('worker', 'after');
			expect(db.get_session('worker')?.agent_name).toBe('after');
			expect(db.resolve_session_targets('after')).toMatchObject([
				{ session_id: 'worker' },
			]);
			expect(db.resolve_session_targets('before')).toEqual([]);

			db.update_session_agent_name('worker', undefined);
			expect(db.get_session('worker')?.agent_name).toBeUndefined();
			expect(db.resolve_session_targets('after')).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('keeps independently opened peers targetable after shutdown', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({
				session_id: 'worker',
				cwd: '/repo',
				agent_name: 'reviewer',
				role: 'peer',
			});

			db.register_session({
				session_id: 'worker',
				cwd: '/repo',
				pid: 123,
				role: 'peer',
				status: 'online',
			});
			db.mark_session_status('worker', 'offline');

			expect(db.get_session('worker')).toMatchObject({
				agent_name: 'reviewer',
				role: 'peer',
				status: 'offline',
			});
			expect(db.resolve_session_targets('worker')).toMatchObject([
				{ session_id: 'worker' },
			]);
			expect(db.resolve_session_targets('reviewer')).toMatchObject([
				{ session_id: 'worker' },
			]);
		} finally {
			db.close();
		}
	});

	it('prefers a single active named session over stale offline duplicates', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 'old-reviewer',
				cwd: '/repo',
				agent_name: 'reviewer',
				status: 'offline',
			});
			db.register_session({
				session_id: 'current-reviewer',
				cwd: '/repo',
				agent_name: 'reviewer',
				status: 'online',
			});

			expect(db.resolve_session_targets('reviewer')).toMatchObject([
				{ session_id: 'current-reviewer' },
			]);
			expect(
				db.resolve_session_targets('old-reviewer'),
			).toMatchObject([
				{ session_id: 'old-reviewer', status: 'offline' },
			]);
		} finally {
			db.close();
		}
	});

	it('keeps offline parent sessions targetable by durable session id', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 'lead-session',
				cwd: '/repo',
				role: 'lead',
				status: 'offline',
			});
			db.register_session({
				session_id: 'worker-session',
				cwd: '/repo',
				role: 'teammate',
				parent_session_id: 'lead-session',
				status: 'online',
			});

			const message = db.send_to_session_target({
				from_session_id: 'worker-session',
				target: 'lead-session',
				body: 'done',
			});

			expect(
				db.resolve_session_targets('lead-session'),
			).toMatchObject([
				{ session_id: 'lead-session', status: 'offline' },
			]);
			expect(db.list_inbox('lead-session')).toMatchObject([
				{ message_id: message.message_id, body: 'done' },
			]);
		} finally {
			db.close();
		}
	});

	it('creates and searches coordination artifacts', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo-a' });
			const artifact = db.create_artifact({
				kind: 'handoff',
				owner_session_id: 'lead',
				cwd: '/repo-a',
				title: 'Review handoff',
				summary: 'Compact summary for mailbox messages',
				body: 'Full plan and findings live here.',
			});

			expect(db.get_artifact(artifact.artifact_id)).toMatchObject({
				kind: 'handoff',
				title: 'Review handoff',
			});
			expect(db.list_artifacts({ cwd: '/repo-a' })).toHaveLength(1);
			expect(
				db.search_artifacts('findings', { cwd: '/repo-a' }),
			).toMatchObject([{ artifact_id: artifact.artifact_id }]);
			expect(db.list_artifacts({ cwd: '/repo-b' })).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('marks registered sessions with dead pids offline', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 'live',
				cwd: '/repo',
				pid: 10,
			});
			db.register_session({
				session_id: 'dead',
				cwd: '/repo',
				pid: 20,
			});
			db.register_session({
				session_id: 'unknown-pid',
				cwd: '/repo',
			});

			expect(
				db.mark_stale_sessions_offline((pid) => pid !== 20),
			).toEqual(['dead']);
			const online_sessions = db.list_sessions();
			expect(online_sessions).toHaveLength(2);
			expect(online_sessions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						session_id: 'unknown-pid',
						status: 'online',
					}),
					expect.objectContaining({
						session_id: 'live',
						status: 'online',
					}),
				]),
			);
			expect(db.list_sessions({ include_offline: true })).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						session_id: 'dead',
						status: 'offline',
						availability: 'offline',
					}),
				]),
			);
		} finally {
			db.close();
		}
	});

	it('resolves unique session id prefixes and reports ambiguous or unknown targets', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: '019f0f71-967e-7aed-853c-94ac29fbe7b6',
				cwd: '/repo-a',
			});
			db.register_session({
				session_id: '019f0f71-7eee-7aed-853c-94ac29fbe7b6',
				cwd: '/repo-b',
			});
			db.register_session({
				session_id: '019f0f71-967f-7aed-853c-94ac29fbe7b6',
				cwd: '/repo-c',
			});

			expect(
				db.resolve_session_targets('019f0f71-7ee'),
			).toMatchObject([
				{ session_id: '019f0f71-7eee-7aed-853c-94ac29fbe7b6' },
			]);
			expect(() =>
				db.resolve_session_targets('019f0f71-967'),
			).toThrow(/Ambiguous session target: 019f0f71-967/);
			expect(() =>
				db.resolve_session_targets('019f0f71-967'),
			).toThrow(/019f0f71-967e-7aed-853c-94ac29fbe7b6/);
			expect(() =>
				db.resolve_session_targets('019f0f71-967'),
			).toThrow(/019f0f71-967f-7aed-853c-94ac29fbe7b6/);
			expect(() =>
				db.send_to_session_target({
					from_session_id: '019f0f71-7eee-7aed-853c-94ac29fbe7b6',
					target: '967e',
					body: 'hello',
				}),
			).toThrow(
				/Unknown session target: 967e\. Matching sessions: 019f0f71-967e-7aed-853c-94ac29fbe7b6/,
			);
		} finally {
			db.close();
		}
	});

	it('resolves group ids exactly and same-name groups only within the caller cwd', async () => {
		const db = await TeamDatabase.open(tmp_db());
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

			expect(
				db.get_group('review', { cwd: '/repo-a' }),
			).toMatchObject({
				group_id: group_a.group_id,
			});
			expect(
				db.get_group('review', { cwd: '/repo-b' }),
			).toMatchObject({
				group_id: group_b.group_id,
			});
			expect(
				db.get_group(group_a.group_id, { cwd: '/repo-b' }),
			).toMatchObject({ group_id: group_a.group_id });
			expect(() => db.get_group('review')).toThrow(
				/Ambiguous group target: review/,
			);
		} finally {
			db.close();
		}
	});

	it('keeps an old group while a member session is active or recently offline', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({ session_id: 'member', cwd: '/repo' });
			const group = db.create_group({
				name: 'long-running',
				cwd: '/repo',
				created_by_session_id: 'member',
			});

			vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
			db.mark_session_status('member', 'offline');
			db.prune_historical_data();

			expect(db.get_group(group.group_id)).toBeDefined();
			expect(db.get_session('member')).toBeDefined();
		} finally {
			db.close();
			vi.useRealTimers();
		}
	});

	it('prunes historical coordination rows without deleting active sessions or unacknowledged messages', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			for (const session_id of [
				'active',
				'group-owner',
				'artifact-owner',
				'ack-sender',
				'ack-recipient',
				'pending-sender',
				'pending-recipient',
			])
				db.register_session({ session_id, cwd: '/repo' });

			const historical_group = db.create_group({
				name: 'historical',
				cwd: '/repo',
				created_by_session_id: 'group-owner',
			});
			const active_group = db.create_group({
				name: 'active-group',
				cwd: '/repo',
				created_by_session_id: 'active',
			});
			const artifact = db.create_artifact({
				kind: 'handoff',
				owner_session_id: 'artifact-owner',
				cwd: '/repo',
				title: 'Historical handoff',
				summary: 'Already completed',
				body: 'Old coordination context',
			});
			const pending_artifact = db.create_artifact({
				kind: 'evidence',
				owner_session_id: 'pending-sender',
				cwd: '/repo',
				title: 'Pending evidence',
				summary: 'Awaiting acknowledgement',
				body: 'Evidence needed to process the pending message',
			});
			const acknowledged = db.send_message({
				from_session_id: 'ack-sender',
				to_session_ids: ['ack-recipient'],
				scope: 'session',
				target: 'ack-recipient',
				body: 'complete',
				ttl_ms: 1,
				requires_ack: true,
			});
			db.mark_messages_acknowledged('ack-recipient', [
				acknowledged.message_id,
			]);
			const pending = db.send_message({
				from_session_id: 'pending-sender',
				to_session_ids: ['pending-recipient'],
				scope: 'session',
				target: 'pending-recipient',
				body: `still pending; see ${pending_artifact.artifact_id}`,
				ttl_ms: 1,
				requires_ack: true,
			});
			db.insert_event({ type: 'historical-test' });
			for (const session_id of [
				'group-owner',
				'artifact-owner',
				'ack-sender',
				'ack-recipient',
				'pending-sender',
				'pending-recipient',
			])
				db.mark_session_status(session_id, 'offline');

			const result = db.prune_historical_data({
				retention_ms: 0,
				reference_time: new Date(Date.now() + 10_000),
			});

			expect(result).toMatchObject({
				artifacts: 1,
				groups: 1,
				messages: 1,
				receipts: 1,
				sessions: 4,
			});
			expect(result.events).toBeGreaterThanOrEqual(3);
			expect(db.get_artifact(artifact.artifact_id)).toBeUndefined();
			expect(
				db.get_artifact(pending_artifact.artifact_id),
			).toBeDefined();
			expect(db.get_group(historical_group.group_id)).toBeUndefined();
			expect(db.get_group(active_group.group_id)).toBeDefined();
			expect(db.get_session('active')).toMatchObject({
				status: 'online',
			});
			expect(db.get_session('pending-sender')).toBeDefined();
			expect(db.get_session('pending-recipient')).toBeDefined();
			expect(
				db.read_rows<{ message_id: string }>(
					'SELECT message_id FROM messages',
				),
			).toEqual([{ message_id: pending.message_id }]);
			expect(
				db.read_rows<{ message_id: string }>(
					'SELECT message_id FROM message_receipts',
				),
			).toEqual([{ message_id: pending.message_id }]);
			expect(db.read_rows('SELECT * FROM events')).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('creates groups and sends group messages to independent sessions', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo-a' });
			db.register_session({ session_id: 'reviewer', cwd: '/repo-b' });
			const group = db.create_group({
				name: 'refactor',
				cwd: '/repo-a',
				created_by_session_id: 'lead',
			});
			db.add_group_member({
				group_id: group.group_id,
				session_id: 'reviewer',
				alias: 'reviewer',
				role: 'reviewer',
			});

			const message = db.send_to_group({
				from_session_id: 'lead',
				target: group.group_id,
				body: 'review the refactor',
			});

			expect(db.list_group_members(group.group_id)).toHaveLength(2);
			expect(db.list_group_memberships('reviewer')).toMatchObject([
				{
					group_id: group.group_id,
					group_name: 'refactor',
					alias: 'reviewer',
					role: 'reviewer',
				},
			]);
			expect(db.list_inbox('reviewer')).toMatchObject([
				{
					message_id: message.message_id,
					scope: 'group',
					body: 'review the refactor',
				},
			]);
			expect(db.list_inbox('lead')).toEqual([]);
		} finally {
			db.close();
		}
	});
});
