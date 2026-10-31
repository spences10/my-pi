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
import { afterEach, describe, expect, it } from 'vite-plus/test';
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

	it('migrates a version 0 events table, backfills columns, and enables incremental vacuum', () => {
		const db_path = tmp_db();
		mkdirSync(dirname(db_path), { recursive: true });
		const legacy = new DatabaseSync(db_path);
		legacy.exec(`
			CREATE TABLE events (
				event_id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				seq INTEGER NOT NULL,
				ts TEXT NOT NULL,
				type TEXT NOT NULL,
				pool TEXT NOT NULL DEFAULT 'default',
				tags_json TEXT NOT NULL DEFAULT '[]',
				payload_json TEXT NOT NULL,
				provider TEXT,
				model TEXT
			)
		`);
		const insert = legacy.prepare(
			'INSERT INTO events (event_id, session_id, seq, ts, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)',
		);
		const rows: Array<[string, string, unknown]> = [
			['2026-10-31T10:00:00.000Z', 'turn_start', { turnIndex: 0 }],
			[
				'2026-10-31T10:00:00.100Z',
				'tool_execution_start',
				{ toolCallId: 'c1', toolName: 'bash' },
			],
			[
				'2026-10-31T10:00:00.400Z',
				'tool_execution_end',
				{
					toolCallId: 'c1',
					toolName: 'bash',
					isError: true,
					durationMs: 250,
				},
			],
			[
				'2026-10-31T10:00:01.000Z',
				'message_end',
				{
					message: {
						role: 'assistant',
						durationMs: 600,
						usage: {
							input: 100,
							output: 20,
							cacheRead: 5,
							cacheWrite: 0,
							totalTokens: '[REDACTED]',
							cost: { total: 0.01 },
						},
					},
				},
			],
			[
				'2026-10-31T10:00:02.000Z',
				'turn_end',
				{ turnIndex: 0, message: { usage: { input: 100 } } },
			],
		];
		rows.forEach(([ts, type, payload], seq) =>
			insert.run(
				`e${seq}`,
				's1',
				seq,
				ts,
				type,
				JSON.stringify(payload),
			),
		);
		legacy.close();

		const { db } = prepare_db(db_path);
		try {
			expect(db.prepare('PRAGMA user_version').get()).toMatchObject({
				user_version: 1,
			});
			expect(db.prepare('PRAGMA auto_vacuum').get()).toMatchObject({
				auto_vacuum: 2,
			});
			expect(
				db
					.prepare(
						'SELECT tool_name, duration_ms, is_error, update_count FROM tool_spans',
					)
					.all(),
			).toEqual([
				{
					tool_name: 'bash',
					duration_ms: 250,
					is_error: 1,
					update_count: null,
				},
			]);
			expect(
				db
					.prepare(
						'SELECT start_seq, turn_index, duration_ms, tool_calls, tool_errors, tool_ms, provider_ms, input_tokens, output_tokens, cache_read_tokens, cost_usd FROM turn_spans',
					)
					.get(),
			).toMatchObject({
				start_seq: 0,
				turn_index: 0,
				tool_calls: 1,
				tool_errors: 1,
				tool_ms: 250,
				provider_ms: 600,
				input_tokens: 100,
				output_tokens: 20,
				cache_read_tokens: 5,
				cost_usd: 0.01,
			});
		} finally {
			db.close();
		}
	});

	it('pairs repeated turn indexes with the next turn_end', () => {
		const { db, statements } = prepare_db(tmp_db());
		try {
			const types = [
				'turn_start',
				'turn_end',
				'turn_start',
				'turn_end',
			];
			types.forEach((type, seq) =>
				statements.insert_event.run(
					`e${seq}`,
					's1',
					seq,
					`2026-10-31T10:00:0${seq}.000Z`,
					type,
					'default',
					'[]',
					'{"turnIndex":0}',
					null,
					null,
					0,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
				),
			);
			expect(
				db
					.prepare(
						'SELECT start_seq, duration_ms FROM turn_spans ORDER BY start_seq',
					)
					.all(),
			).toEqual([
				{ start_seq: 0, duration_ms: 1000 },
				{ start_seq: 2, duration_ms: 1000 },
			]);
		} finally {
			db.close();
		}
	});

	it('refuses databases from a newer schema version', () => {
		const db_path = tmp_db();
		mkdirSync(dirname(db_path), { recursive: true });
		const future = new DatabaseSync(db_path);
		future.exec('PRAGMA user_version = 99');
		future.close();
		expect(() => prepare_db(db_path)).toThrow(
			'schema version 99 is newer',
		);
	});

	it('creates new databases with incremental vacuum and no rebuild', () => {
		const { db } = prepare_db(tmp_db());
		try {
			expect(db.prepare('PRAGMA auto_vacuum').get()).toMatchObject({
				auto_vacuum: 2,
			});
			expect(db.prepare('PRAGMA user_version').get()).toMatchObject({
				user_version: 1,
			});
		} finally {
			db.close();
		}
	});
});
