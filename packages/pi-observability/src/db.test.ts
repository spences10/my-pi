import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { prepare_db } from './db.js';

const dirs: string[] = [];

function tmp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-observability-db-'));
	dirs.push(dir);
	return join(dir, 'nested', 'events.db');
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('prepare_db', () => {
	it('creates parent directories, applies schema, and returns prepared statements', () => {
		const db_path = tmp_db();
		const { db, statements } = prepare_db(db_path);
		try {
			expect(existsSync(db_path)).toBe(true);
			if (process.platform !== 'win32') {
				for (const path of [
					db_path,
					`${db_path}-wal`,
					`${db_path}-shm`,
				]) {
					expect(statSync(path).mode & 0o777).toBe(0o600);
				}
			}
			expect(Object.keys(statements).sort()).toEqual([
				'clear_session_name',
				'delete_old_events',
				'delete_orphan_sessions',
				'delete_over_limit_events',
				'get_session',
				'insert_event',
				'list_events',
				'list_sessions',
				'next_event_seq',
				'search_events',
				'upsert_session',
			]);
			expect(
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'",
					)
					.get(),
			).toMatchObject({ name: 'events' });
		} finally {
			db.close();
		}
	});

	it('adds session_name to existing databases safely', () => {
		const db_path = tmp_db();
		mkdirSync(dirname(db_path), { recursive: true });
		const legacy = new DatabaseSync(db_path);
		legacy.exec(`
			CREATE TABLE sessions (
				session_id TEXT PRIMARY KEY,
				pool TEXT NOT NULL DEFAULT 'default',
				agent_name TEXT,
				cwd TEXT,
				session_file TEXT,
				provider TEXT,
				model TEXT,
				first_ts TEXT NOT NULL,
				last_ts TEXT NOT NULL,
				event_count INTEGER NOT NULL DEFAULT 0,
				tags_json TEXT NOT NULL DEFAULT '[]'
			)
		`);
		legacy.close();

		const { db } = prepare_db(db_path);
		try {
			const columns = db
				.prepare('PRAGMA table_info(sessions)')
				.all() as Array<{
				name: string;
			}>;
			expect(columns.map((column) => column.name)).toContain(
				'session_name',
			);
		} finally {
			db.close();
		}
	});
});
