import {
	SQLITE_PERSISTENT_PRAGMAS,
	sqlite_pragmas,
	with_sqlite_transaction,
} from '@spences10/pi-sqlite-core';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
	derive_event_columns,
	EVENT_COLUMN_NAMES,
	event_column_values,
} from './event-columns.js';

export const OBSERVABILITY_SCHEMA_VERSION = 2;

const DERIVED_COLUMN_TYPES: Record<
	(typeof EVENT_COLUMN_NAMES)[number],
	string
> = {
	turn_index: 'INTEGER',
	tool_call_id: 'TEXT',
	tool_name: 'TEXT',
	is_error: 'INTEGER',
	duration_ms: 'REAL',
	stop_reason: 'TEXT',
	input_tokens: 'INTEGER',
	output_tokens: 'INTEGER',
	cache_read_tokens: 'INTEGER',
	cache_write_tokens: 'INTEGER',
	cost_usd: 'REAL',
	error_text: 'TEXT',
	exit_code: 'INTEGER',
	parent_tool_call_id: 'TEXT',
};

export interface PreparedStatements {
	next_event_seq: StatementSync;
	insert_event: StatementSync;
	upsert_session: StatementSync;
	list_sessions: StatementSync;
	get_session: StatementSync;
	clear_session_name: StatementSync;
	list_events: StatementSync;
	search_events: StatementSync;
	delete_old_events: StatementSync;
	delete_over_limit_events: StatementSync;
	delete_orphan_sessions: StatementSync;
}

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf8',
);
const PERSISTENT_PRAGMAS = SQLITE_PERSISTENT_PRAGMAS;
const CONNECTION_PRAGMAS = sqlite_pragmas({
	foreign_keys: false,
}).connection;

export function prepare_db(db_path: string): {
	db: DatabaseSync;
	statements: PreparedStatements;
} {
	mkdirSync(dirname(db_path), { recursive: true });
	const db = new DatabaseSync(db_path);
	// auto_vacuum only takes effect on a new database; existing
	// databases switch over with one VACUUM in migrate_db.
	db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
	db.exec(PERSISTENT_PRAGMAS);
	db.exec(CONNECTION_PRAGMAS);
	migrate_db(db);
	for (const path of [db_path, `${db_path}-wal`, `${db_path}-shm`]) {
		if (existsSync(path)) chmodSync(path, 0o600);
	}
	const derived_columns = EVENT_COLUMN_NAMES.join(', ');
	const derived_params = EVENT_COLUMN_NAMES.map(() => '?').join(', ');
	return {
		db,
		statements: {
			next_event_seq: db.prepare(`
				SELECT COALESCE(MAX(seq) + 1, 0) AS seq
				FROM events
				WHERE session_id = ?
			`),
			insert_event: db.prepare(`
				INSERT OR IGNORE INTO events
				(event_id, session_id, seq, ts, type, pool, tags_json, payload_json, provider, model, ${derived_columns})
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${derived_params})
			`),
			upsert_session: db.prepare(`
				INSERT INTO sessions
				(session_id, pool, agent_name, session_name, cwd, session_file, provider, model, first_ts, last_ts, event_count, tags_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					pool = excluded.pool,
					agent_name = COALESCE(excluded.agent_name, sessions.agent_name),
					session_name = COALESCE(excluded.session_name, sessions.session_name),
					cwd = COALESCE(excluded.cwd, sessions.cwd),
					session_file = COALESCE(excluded.session_file, sessions.session_file),
					provider = COALESCE(excluded.provider, sessions.provider),
					model = COALESCE(excluded.model, sessions.model),
					last_ts = MAX(excluded.last_ts, sessions.last_ts),
					event_count = sessions.event_count + 1,
					tags_json = excluded.tags_json
			`),
			list_sessions: db.prepare(`
				SELECT * FROM sessions
				WHERE (? = '' OR pool = ?)
				ORDER BY last_ts DESC
				LIMIT ?
			`),
			get_session: db.prepare(`
				SELECT * FROM sessions WHERE session_id = ?
			`),
			clear_session_name: db.prepare(`
				UPDATE sessions SET session_name = NULL WHERE session_id = ?
			`),
			list_events: db.prepare(`
				SELECT * FROM events
				WHERE session_id = ?
				ORDER BY seq DESC
				LIMIT ?
			`),
			search_events: db.prepare(`
				SELECT * FROM events
				WHERE (? = '' OR session_id = ?)
					AND (? = '' OR type = ?)
					AND (? = '' OR payload_json LIKE ?)
				ORDER BY ts DESC
				LIMIT ?
			`),
			delete_old_events: db.prepare(`
				DELETE FROM events
				WHERE ts < datetime('now', '-' || ? || ' days')
			`),
			delete_over_limit_events: db.prepare(`
				DELETE FROM events
				WHERE event_id IN (
					SELECT event_id FROM events ORDER BY ts DESC LIMIT -1 OFFSET ?
				)
			`),
			delete_orphan_sessions: db.prepare(`
				DELETE FROM sessions
				WHERE session_id NOT IN (SELECT DISTINCT session_id FROM events)
			`),
		},
	};
}

function table_columns(db: DatabaseSync, table: string): Set<string> {
	const rows = db
		.prepare(`PRAGMA table_info(${table})`)
		.all() as Array<{ name: string }>;
	return new Set(rows.map((row) => row.name));
}

function scalar(db: DatabaseSync, sql: string): number {
	const row = db.prepare(sql).get() as Record<string, unknown>;
	return Number(Object.values(row)[0] ?? 0);
}

/**
 * Brings any older database up to OBSERVABILITY_SCHEMA_VERSION.
 *
 * Version 0 had no derived event columns, no span views, and
 * auto_vacuum off. Version 1 added the derived columns. Version 2 adds
 * error_text, exit_code, and parent_tool_call_id. A migration adds the
 * missing columns and fills all derived columns from payload_json; a
 * database still on auto_vacuum off gets one VACUUM. schema.sql drops
 * and recreates the views on every start.
 */
export function migrate_db(db: DatabaseSync): void {
	const version = scalar(db, 'PRAGMA user_version');
	if (version > OBSERVABILITY_SCHEMA_VERSION)
		throw new Error(
			`Observability database schema version ${version} is newer than supported version ${OBSERVABILITY_SCHEMA_VERSION}`,
		);

	const event_columns = table_columns(db, 'events');
	const existing_events = event_columns.size > 0;
	if (existing_events) {
		for (const name of EVENT_COLUMN_NAMES) {
			if (!event_columns.has(name))
				db.exec(
					`ALTER TABLE events ADD COLUMN ${name} ${DERIVED_COLUMN_TYPES[name]}`,
				);
		}
	}
	const session_columns = table_columns(db, 'sessions');
	if (
		session_columns.size > 0 &&
		!session_columns.has('session_name')
	)
		db.exec('ALTER TABLE sessions ADD COLUMN session_name TEXT');

	db.exec(SCHEMA);

	// Every version so far adds derived columns, so re-derive them all.
	if (version < OBSERVABILITY_SCHEMA_VERSION && existing_events)
		backfill_event_columns(db);
	if (version < OBSERVABILITY_SCHEMA_VERSION)
		db.exec(`PRAGMA user_version = ${OBSERVABILITY_SCHEMA_VERSION}`);
	if (scalar(db, 'PRAGMA auto_vacuum') !== 2) {
		db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
		db.exec('VACUUM');
	}
}

function backfill_event_columns(db: DatabaseSync): void {
	const assignments = EVENT_COLUMN_NAMES.map(
		(name) => `${name} = ?`,
	).join(', ');
	const update = db.prepare(
		`UPDATE events SET ${assignments} WHERE event_id = ?`,
	);
	const rows = db
		.prepare('SELECT event_id, type, payload_json FROM events')
		.all() as Array<{
		event_id: string;
		type: string;
		payload_json: string;
	}>;
	with_sqlite_transaction(
		db,
		() => {
			for (const row of rows) {
				let payload: unknown;
				try {
					payload = JSON.parse(row.payload_json);
				} catch {
					continue;
				}
				update.run(
					...event_column_values(
						derive_event_columns(row.type, payload),
					),
					row.event_id,
				);
			}
		},
		{
			immediate: true,
			operation: 'Backfill observability event columns',
		},
	);
}
