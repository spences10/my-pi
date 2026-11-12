import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { TeamDatabase } from './index.js';
import {
	LATEST_TEAM_SCHEMA_VERSION,
	load_migrations,
	MIGRATIONS,
} from './schema.js';

const dirs: string[] = [];

function migration_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-migrations-'));
	dirs.push(dir);

	return dir;
}

function directory_url(dir: string): URL {
	return pathToFileURL(`${dir}/`);
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('Team Mode migration discovery', () => {
	it('discovers the immutable contiguous migration sequence', () => {
		expect(
			MIGRATIONS.map((migration) => migration.file_name),
		).toEqual([
			'001_initial.sql',
			'002_session_thinking_level.sql',
			'003_session_availability_artifacts.sql',
			'004_persistent_runtimes.sql',
			'005_message_delivery.sql',
			'006_delivery_policy.sql',
		]);
		expect(LATEST_TEAM_SCHEMA_VERSION).toBe(6);
		expect(MIGRATIONS[0]?.sql).not.toContain('thinking_level');
		expect(MIGRATIONS[1]?.sql).toContain('thinking_level');
	});

	it.each([4, 5])(
		'upgrades v%i messages without losing bodies or automatically replaying old mail',
		async (version) => {
			const path = join(migration_dir(), 'coordination.db');
			const old = new DatabaseSync(path);

			try {
				for (const migration of MIGRATIONS.slice(0, version))
					old.exec(migration.sql);
				old.exec(`PRAGMA user_version = ${version}`);

				for (const id of ['sender', 'receiver'])
					old
						.prepare(
							'INSERT INTO sessions (session_id, cwd, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
						)
						.run(
							id,
							'/repo',
							'2026-01-01',
							'2026-01-01',
							'2026-01-01',
						);

				for (const id of ['reviewed', 'completed', 'pending']) {
					old
						.prepare(
							"INSERT INTO messages (message_id, from_session_id, scope, target, body, created_at) VALUES (?, 'sender', 'session', 'receiver', ?, '2026-01-01')",
						)
						.run(id, `original ${id}`);
					old
						.prepare(
							"INSERT INTO message_receipts (message_id, to_session_id, read_at, acknowledged_at, created_at) VALUES (?, 'receiver', ?, ?, '2026-01-01')",
						)
						.run(
							id,
							id === 'reviewed' ? '2026-01-02' : null,
							id === 'completed' ? '2026-01-03' : null,
						);
				}

				if (version === 5)
					old.exec(
						`UPDATE message_receipts SET delivered_at = COALESCE(read_at, acknowledged_at), read_at = COALESCE(read_at, acknowledged_at)`,
					);
			} finally {
				old.close();
			}

			const db = await TeamDatabase.open(path);

			try {
				expect(db.get_schema_version()).toBe(6);
				expect(db.list_auto_inbox('receiver')).toEqual([]);

				const receipts = db.list_inbox('receiver', {
					include_read: true,
					include_acknowledged: true,
				});

				expect(receipts).toHaveLength(3);
				expect(
					receipts.every(
						(message) =>
							message.message_type === 'action' &&
							!message.idempotency_key,
					),
				).toBe(true);
				expect(
					receipts.find(
						(message) => message.message_id === 'reviewed',
					),
				).toMatchObject({
					body: 'original reviewed',
					delivered_at: '2026-01-02',
					read_at: '2026-01-02',
				});
				expect(
					receipts.find(
						(message) => message.message_id === 'completed',
					),
				).toMatchObject({
					body: 'original completed',
					delivered_at: '2026-01-03',
					read_at: '2026-01-03',
					acknowledged_at: '2026-01-03',
				});
				expect(
					db
						.list_inbox('receiver', { undelivered_only: true })
						.map((message) => message.message_id),
				).toEqual(['pending']);
			} finally {
				db.close();
			}
		},
	);

	it('rejects gaps instead of silently skipping a version', () => {
		const dir = migration_dir();
		writeFileSync(join(dir, '001_initial.sql'), 'SELECT 1;');
		writeFileSync(join(dir, '003_gap.sql'), 'SELECT 3;');

		expect(() => load_migrations(directory_url(dir))).toThrow(
			'expected 002, found 003_gap.sql',
		);
	});

	it('rejects SQL files that do not follow the numbered convention', () => {
		const dir = migration_dir();
		writeFileSync(join(dir, '001_initial.sql'), 'SELECT 1;');
		writeFileSync(join(dir, 'notes.sql'), 'SELECT 2;');

		expect(() => load_migrations(directory_url(dir))).toThrow(
			'Invalid Team Mode migration filename: notes.sql',
		);
	});
});
