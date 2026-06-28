import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from './db.js';

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
			expect(db.get_schema_version()).toBe(1);
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

	it('registers sessions and sends direct peer messages with receipt state', async () => {
		const db = await TeamDatabase.open(tmp_db());
		try {
			db.register_session({
				session_id: 's1',
				cwd: '/repo-a',
				agent_name: 'alpha',
				pid: 1,
				model_id: 'model-a',
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

			expect(db.list_sessions()).toHaveLength(2);
			expect(db.resolve_session_targets('beta')).toHaveLength(1);
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
