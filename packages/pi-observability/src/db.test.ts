import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
			expect(Object.keys(statements).sort()).toEqual([
				'delete_old_events',
				'delete_orphan_sessions',
				'delete_over_limit_events',
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
});
