import type { DatabaseSync } from 'node:sqlite';
import type { TeamDatabaseStatements } from './types.js';

export function prepare_statements(
	db: DatabaseSync,
): TeamDatabaseStatements {
	return {
		register_session: db.prepare(`
				INSERT INTO sessions
				(session_id, session_file, cwd, agent_name, pid, role, status, model_provider, model_id, thinking_level, availability, intent, session_alias, parent_session_id, pool, tags_json, metadata_json, created_at, updated_at, last_seen_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					session_file = excluded.session_file,
					cwd = excluded.cwd,
					agent_name = COALESCE(excluded.agent_name, sessions.agent_name),
					pid = excluded.pid,
					role = excluded.role,
					status = excluded.status,
					model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
					model_id = COALESCE(excluded.model_id, sessions.model_id),
					thinking_level = COALESCE(excluded.thinking_level, sessions.thinking_level),
					availability = excluded.availability,
					intent = COALESCE(excluded.intent, sessions.intent),
					session_alias = COALESCE(excluded.session_alias, sessions.session_alias),
					parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
					pool = excluded.pool,
					tags_json = excluded.tags_json,
					metadata_json = excluded.metadata_json,
					updated_at = excluded.updated_at,
					last_seen_at = excluded.last_seen_at,
					offline_at = NULL
			`),
		get_session: db.prepare(
			'SELECT * FROM sessions WHERE session_id = ?',
		),
		list_sessions: db.prepare(
			'SELECT * FROM sessions ORDER BY last_seen_at DESC',
		),
		list_online_sessions: db.prepare(
			"SELECT * FROM sessions WHERE status != 'offline' ORDER BY last_seen_at DESC",
		),
		resolve_session_target: db.prepare(
			"SELECT * FROM sessions WHERE status != 'offline' AND (session_id = ? OR agent_name = ?) ORDER BY last_seen_at DESC",
		),
		mark_session_status: db.prepare(`
				UPDATE sessions
				SET status = ?, updated_at = ?, last_seen_at = ?, offline_at = ?,
					availability = CASE WHEN ? = 'offline' THEN 'offline' ELSE availability END
				WHERE session_id = ?
			`),
		insert_artifact: db.prepare(`
				INSERT INTO coordination_artifacts
				(artifact_id, kind, owner_session_id, cwd, title, summary, body, body_format, created_at, updated_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
		get_artifact: db.prepare(
			'SELECT * FROM coordination_artifacts WHERE artifact_id = ?',
		),
		list_artifacts: db.prepare(`
				SELECT * FROM coordination_artifacts
				WHERE (? IS NULL OR cwd = ?) AND (? IS NULL OR kind = ?)
				ORDER BY updated_at DESC
			`),
		search_artifacts: db.prepare(`
				SELECT * FROM coordination_artifacts
				WHERE (? IS NULL OR cwd = ?)
					AND (title LIKE ? OR summary LIKE ? OR body LIKE ?)
				ORDER BY updated_at DESC
			`),
		insert_group: db.prepare(`
				INSERT INTO groups (group_id, name, cwd, created_by_session_id, created_at, updated_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`),
		get_group: db.prepare('SELECT * FROM groups WHERE group_id = ?'),
		find_group_by_name: db.prepare(
			'SELECT * FROM groups WHERE name = ? ORDER BY updated_at DESC LIMIT 1',
		),
		list_groups: db.prepare(
			'SELECT * FROM groups ORDER BY updated_at DESC',
		),
		upsert_group_member: db.prepare(`
				INSERT INTO group_members (group_id, session_id, alias, role, status, joined_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(group_id, session_id) DO UPDATE SET
					alias = excluded.alias,
					role = excluded.role,
					status = excluded.status,
					updated_at = excluded.updated_at
			`),
		list_group_members: db.prepare(
			'SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at ASC',
		),
		list_group_memberships: db.prepare(`
				SELECT group_members.*, groups.name AS group_name, groups.cwd AS group_cwd
				FROM group_members
				JOIN groups ON groups.group_id = group_members.group_id
				WHERE group_members.session_id = ? AND group_members.status = 'active'
				ORDER BY groups.updated_at DESC
			`),
		insert_message: db.prepare(`
				INSERT INTO messages
				(message_id, from_session_id, scope, target, body, urgent, reply_to, expires_at, requires_ack, created_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
		insert_message_receipt: db.prepare(`
				INSERT OR IGNORE INTO message_receipts (message_id, to_session_id, created_at)
				VALUES (?, ?, ?)
			`),
		list_inbox: db.prepare(`
				SELECT messages.*, message_receipts.to_session_id, message_receipts.delivered_at,
					message_receipts.read_at, message_receipts.acknowledged_at,
					message_receipts.created_at AS receipt_created_at,
					sessions.agent_name AS from_agent_name, sessions.cwd AS from_cwd
				FROM message_receipts
				JOIN messages ON messages.message_id = message_receipts.message_id
				LEFT JOIN sessions ON sessions.session_id = messages.from_session_id
				WHERE message_receipts.to_session_id = ?
				ORDER BY messages.created_at ASC
			`),
		mark_messages_delivered: db.prepare(`
				UPDATE message_receipts SET delivered_at = COALESCE(delivered_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
		mark_messages_read: db.prepare(`
				UPDATE message_receipts SET read_at = COALESCE(read_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
		mark_messages_acknowledged: db.prepare(`
				UPDATE message_receipts SET acknowledged_at = COALESCE(acknowledged_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
		insert_event: db.prepare(`
				INSERT INTO events (event_id, type, session_id, group_id, message_id, created_at, data_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`),
		get_session_runtime: db.prepare(
			'SELECT * FROM session_runtimes WHERE session_id = ?',
		),
		insert_session_runtime: db.prepare(`
				INSERT OR IGNORE INTO session_runtimes
				(session_id, runtime_id, generation, pid, process_identity_json, endpoint, state, autonomous, control_owner, heartbeat_at, lease_expires_at, diagnostics_json, created_at, updated_at)
				VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
		replace_session_runtime: db.prepare(`
				UPDATE session_runtimes SET
					runtime_id = ?, generation = generation + 1, pid = ?,
					process_identity_json = ?, endpoint = ?, state = ?, autonomous = ?,
					control_owner = ?, heartbeat_at = ?, lease_expires_at = ?,
					ready_at = NULL, stopped_at = NULL, exit_code = NULL,
					exit_signal = NULL, error = NULL, diagnostics_json = ?, updated_at = ?
				WHERE session_id = ? AND generation = ? AND lease_expires_at <= ?
			`),
		adopt_session_runtime: db.prepare(`
				UPDATE session_runtimes SET
					pid = ?, process_identity_json = ?, endpoint = ?, state = ?,
					heartbeat_at = ?, lease_expires_at = ?, diagnostics_json = ?, updated_at = ?
				WHERE session_id = ? AND runtime_id = ? AND generation = ?
					AND state = 'created' AND pid IS NULL
			`),
		heartbeat_session_runtime: db.prepare(`
				UPDATE session_runtimes SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
				WHERE session_id = ? AND runtime_id = ? AND generation = ?
			`),
		transition_session_runtime: db.prepare(`
				UPDATE session_runtimes SET
					state = ?, ready_at = COALESCE(?, ready_at), stopped_at = COALESCE(?, stopped_at),
					exit_code = COALESCE(?, exit_code), exit_signal = COALESCE(?, exit_signal),
					error = ?, diagnostics_json = ?, lease_expires_at = ?, updated_at = ?
				WHERE session_id = ? AND runtime_id = ? AND generation = ?
			`),
		insert_runtime_event: db.prepare(`
				INSERT INTO runtime_events
				(event_id, session_id, runtime_id, generation, state, created_at, diagnostics_json, data_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`),
		list_runtime_events: db.prepare(`
				SELECT * FROM runtime_events WHERE session_id = ? ORDER BY created_at ASC, rowid ASC
			`),
	};
}
