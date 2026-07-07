import {
	SQLITE_PERSISTENT_PRAGMAS,
	sqlite_pragmas,
} from '@spences10/pi-sqlite-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface PreparedStatements {
	next_event_seq: StatementSync;
	insert_event: StatementSync;
	upsert_session: StatementSync;
	list_sessions: StatementSync;
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
	db.exec(PERSISTENT_PRAGMAS);
	db.exec(CONNECTION_PRAGMAS);
	db.exec(SCHEMA);
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
				(event_id, session_id, seq, ts, type, pool, tags_json, payload_json, provider, model)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
			upsert_session: db.prepare(`
				INSERT INTO sessions
				(session_id, pool, agent_name, cwd, session_file, provider, model, first_ts, last_ts, event_count, tags_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					pool = excluded.pool,
					agent_name = COALESCE(excluded.agent_name, sessions.agent_name),
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
