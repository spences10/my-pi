import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from './index.js';

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
	it('creates parent directories, applies pragmas, and migrates schema version', async () => {
		const db_path = tmp_db();
		const db = await TeamDatabase.open(db_path);
		try {
			expect(existsSync(db_path)).toBe(true);
			expect(db.get_schema_version()).toBe(3);
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

	it('migrates existing v1 coordination databases to thinking-level schema', async () => {
		const db_path = tmp_db();
		mkdirSync(join(db_path, '..'), { recursive: true });
		const { DatabaseSync } = await import('node:sqlite');
		const v1_db = new DatabaseSync(db_path);
		try {
			const current_schema = readFileSync(
				new URL('./schema.sql', import.meta.url),
				'utf8',
			);
			const v1_schema = current_schema
				.replace('\n\tthinking_level TEXT,', '')
				.replace(
					"\n\tavailability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'standby', 'handoff', 'offline')),",
					'',
				)
				.replace('\n\tintent TEXT,', '')
				.replace('\n\tsession_alias TEXT,', '')
				.replace('\n\tparent_session_id TEXT,', '')
				.replace(
					/CREATE TABLE IF NOT EXISTS coordination_artifacts \([\s\S]*?\);\n\n/,
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_sessions_availability ON sessions(availability);\n',
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_sessions_intent ON sessions(intent);\n',
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_sessions_session_alias ON sessions(session_alias);\n',
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_owner ON coordination_artifacts(owner_session_id);\n',
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_cwd_kind ON coordination_artifacts(cwd, kind);\n',
					'',
				)
				.replace(
					'CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_updated ON coordination_artifacts(updated_at);\n',
					'',
				);
			v1_db.exec(v1_schema);
			v1_db.exec('PRAGMA user_version = 1;');
		} finally {
			v1_db.close();
		}

		const db = await TeamDatabase.open(db_path);
		try {
			expect(db.get_schema_version()).toBe(3);
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
