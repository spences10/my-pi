import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DatabaseSync, StatementSync } from 'node:sqlite';

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf-8',
);
export const LATEST_TEAM_SCHEMA_VERSION = 2;
const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;
const CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
const MIGRATIONS: Record<number, string> = {
	1: SCHEMA,
	2: `ALTER TABLE sessions ADD COLUMN thinking_level TEXT;`,
};

type DatabaseSyncConstructor =
	typeof import('node:sqlite').DatabaseSync;

export type CoordinationSessionStatus =
	| 'online'
	| 'idle'
	| 'running'
	| 'blocked'
	| 'offline';
export type CoordinationRole = 'peer' | 'lead' | 'teammate';
export type CoordinationGroupRole =
	| 'lead'
	| 'teammate'
	| 'peer'
	| 'reviewer';
export type CoordinationTaskStatus =
	| 'pending'
	| 'in_progress'
	| 'blocked'
	| 'completed'
	| 'cancelled';

export interface CoordinationSessionInput {
	session_id: string;
	session_file?: string;
	cwd: string;
	agent_name?: string;
	pid?: number;
	role?: CoordinationRole;
	status?: CoordinationSessionStatus;
	model_provider?: string;
	model_id?: string;
	thinking_level?: string;
	pool?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

export interface CoordinationSession extends Required<
	Pick<CoordinationSessionInput, 'session_id' | 'cwd'>
> {
	session_file?: string;
	agent_name?: string;
	pid?: number;
	role: CoordinationRole;
	status: CoordinationSessionStatus;
	model_provider?: string;
	model_id?: string;
	thinking_level?: string;
	pool: string;
	tags: string[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	last_seen_at: string;
	offline_at?: string;
}

export interface CoordinationGroup {
	group_id: string;
	name: string;
	cwd?: string;
	created_by_session_id?: string;
	created_at: string;
	updated_at: string;
	next_task_id: number;
	metadata: Record<string, unknown>;
}

export interface CoordinationGroupMember {
	group_id: string;
	session_id: string;
	alias?: string;
	role: CoordinationGroupRole;
	status: 'active' | 'inactive';
	joined_at: string;
	updated_at: string;
}

export interface CoordinationGroupMembership extends CoordinationGroupMember {
	group_name: string;
	group_cwd?: string;
}

export interface CoordinationMessageInput {
	from_session_id: string;
	to_session_ids: string[];
	scope: 'session' | 'group' | 'broadcast';
	target: string;
	body: string;
	urgent?: boolean;
	reply_to?: string;
	ttl_ms?: number;
	requires_ack?: boolean;
	metadata?: Record<string, unknown>;
}

export interface CoordinationMessage {
	message_id: string;
	from_session_id: string;
	scope: 'session' | 'group' | 'broadcast';
	target: string;
	body: string;
	urgent: boolean;
	reply_to?: string;
	expires_at?: string;
	requires_ack: boolean;
	created_at: string;
	metadata: Record<string, unknown>;
}

export interface CoordinationInboxMessage extends CoordinationMessage {
	to_session_id: string;
	delivered_at?: string;
	read_at?: string;
	acknowledged_at?: string;
	receipt_created_at: string;
	from_agent_name?: string;
	from_cwd?: string;
}

interface SessionRow {
	session_id: string;
	session_file: string | null;
	cwd: string;
	agent_name: string | null;
	pid: number | null;
	role: CoordinationRole;
	status: CoordinationSessionStatus;
	model_provider: string | null;
	model_id: string | null;
	thinking_level: string | null;
	pool: string;
	tags_json: string;
	metadata_json: string;
	created_at: string;
	updated_at: string;
	last_seen_at: string;
	offline_at: string | null;
}

interface GroupRow {
	group_id: string;
	name: string;
	cwd: string | null;
	created_by_session_id: string | null;
	created_at: string;
	updated_at: string;
	next_task_id: number;
	metadata_json: string;
}

interface GroupMemberRow {
	group_id: string;
	session_id: string;
	alias: string | null;
	role: CoordinationGroupRole;
	status: 'active' | 'inactive';
	joined_at: string;
	updated_at: string;
}

interface GroupMembershipRow extends GroupMemberRow {
	group_name: string;
	group_cwd: string | null;
}

interface InboxRow {
	message_id: string;
	from_session_id: string;
	scope: 'session' | 'group' | 'broadcast';
	target: string;
	body: string;
	urgent: number;
	reply_to: string | null;
	expires_at: string | null;
	requires_ack: number;
	created_at: string;
	metadata_json: string;
	to_session_id: string;
	delivered_at: string | null;
	read_at: string | null;
	acknowledged_at: string | null;
	receipt_created_at: string;
	from_agent_name: string | null;
	from_cwd: string | null;
}

export interface TeamDatabaseStatements {
	register_session: StatementSync;
	get_session: StatementSync;
	list_sessions: StatementSync;
	list_online_sessions: StatementSync;
	resolve_session_target: StatementSync;
	mark_session_status: StatementSync;
	insert_group: StatementSync;
	get_group: StatementSync;
	find_group_by_name: StatementSync;
	list_groups: StatementSync;
	upsert_group_member: StatementSync;
	list_group_members: StatementSync;
	list_group_memberships: StatementSync;
	insert_message: StatementSync;
	insert_message_receipt: StatementSync;
	list_inbox: StatementSync;
	mark_messages_delivered: StatementSync;
	mark_messages_read: StatementSync;
	mark_messages_acknowledged: StatementSync;
	insert_event: StatementSync;
}

function now(): string {
	return new Date().toISOString();
}

function json<T>(value: T): string {
	return JSON.stringify(value ?? null);
}

function parse_json<T>(value: string | null, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function optional<T>(value: T | null): T | undefined {
	return value === null ? undefined : value;
}

function bool(value: number | null | undefined): boolean {
	return value === 1;
}

function get_user_version(db: DatabaseSync): number {
	const row = db.prepare('PRAGMA user_version').get() as {
		user_version: number;
	};
	return row.user_version;
}

export class TeamDatabase {
	readonly statements: TeamDatabaseStatements;
	private db: DatabaseSync;

	static async open(db_path: string): Promise<TeamDatabase> {
		const sqlite = await import('node:sqlite');
		return new TeamDatabase(sqlite.DatabaseSync, db_path);
	}

	constructor(
		DatabaseSyncCtor: DatabaseSyncConstructor,
		db_path: string,
	) {
		const dir = dirname(db_path);
		if (!existsSync(dir))
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		this.db = new DatabaseSyncCtor(db_path, {
			enableForeignKeyConstraints: true,
		});
		this.db.exec(PERSISTENT_PRAGMAS);
		this.db.exec(CONNECTION_PRAGMAS);
		this.apply_migrations();
		this.statements = this.prepare_statements();
	}

	register_session(
		input: CoordinationSessionInput,
	): CoordinationSession {
		const timestamp = now();
		this.statements.register_session.run(
			input.session_id,
			input.session_file ?? null,
			input.cwd,
			input.agent_name ?? null,
			input.pid ?? null,
			input.role ?? 'peer',
			input.status ?? 'online',
			input.model_provider ?? null,
			input.model_id ?? null,
			input.thinking_level ?? null,
			input.pool ?? 'default',
			json(input.tags ?? []),
			json(input.metadata ?? {}),
			timestamp,
			timestamp,
			timestamp,
		);
		return this.get_session(input.session_id)!;
	}

	get_session(session_id: string): CoordinationSession | undefined {
		const row = this.statements.get_session.get(session_id) as
			| SessionRow
			| undefined;
		return row ? this.map_session(row) : undefined;
	}

	list_sessions(
		options: { include_offline?: boolean } = {},
	): CoordinationSession[] {
		const rows = (options.include_offline
			? this.statements.list_sessions.all()
			: this.statements.list_online_sessions.all()) as unknown as SessionRow[];
		return rows.map((row) => this.map_session(row));
	}

	resolve_session_targets(target: string): CoordinationSession[] {
		const sessions = (
			this.statements.list_online_sessions.all() as unknown as SessionRow[]
		).map((row) => this.map_session(row));
		const exact = sessions.filter(
			(session) =>
				session.session_id === target ||
				session.agent_name === target,
		);
		if (exact.length > 0) return exact;

		const prefix_matches = sessions.filter((session) =>
			session.session_id.startsWith(target),
		);
		if (prefix_matches.length <= 1) return prefix_matches;

		throw new Error(
			`Ambiguous session target: ${target}. Matching sessions: ${prefix_matches
				.map((session) => session.session_id)
				.join(', ')}`,
		);
	}

	mark_session_status(
		session_id: string,
		status: CoordinationSessionStatus,
	): void {
		const timestamp = now();
		this.statements.mark_session_status.run(
			status,
			timestamp,
			timestamp,
			status === 'offline' ? timestamp : null,
			session_id,
		);
	}

	heartbeat_session(session_id: string): void {
		this.mark_session_status(session_id, 'online');
	}

	create_group(input: {
		name: string;
		cwd?: string;
		created_by_session_id?: string;
		metadata?: Record<string, unknown>;
	}): CoordinationGroup {
		const timestamp = now();
		const group_id = `${input.name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, '-')}-${Date.now().toString(36)}`;
		this.statements.insert_group.run(
			group_id,
			input.name.trim(),
			input.cwd ?? null,
			input.created_by_session_id ?? null,
			timestamp,
			timestamp,
			json(input.metadata ?? {}),
		);
		if (input.created_by_session_id) {
			this.add_group_member({
				group_id,
				session_id: input.created_by_session_id,
				alias: 'lead',
				role: 'lead',
			});
		}
		return this.get_group(group_id)!;
	}

	get_group(group_id_or_name: string): CoordinationGroup | undefined {
		const row =
			(this.statements.get_group.get(group_id_or_name) as
				| GroupRow
				| undefined) ??
			(this.statements.find_group_by_name.get(group_id_or_name) as
				| GroupRow
				| undefined);
		return row ? this.map_group(row) : undefined;
	}

	list_groups(): CoordinationGroup[] {
		return (
			this.statements.list_groups.all() as unknown as GroupRow[]
		).map((row) => this.map_group(row));
	}

	add_group_member(input: {
		group_id: string;
		session_id: string;
		alias?: string;
		role?: CoordinationGroupRole;
	}): CoordinationGroupMember {
		const timestamp = now();
		this.statements.upsert_group_member.run(
			input.group_id,
			input.session_id,
			input.alias ?? null,
			input.role ?? 'peer',
			'active',
			timestamp,
			timestamp,
		);
		return this.list_group_members(input.group_id).find(
			(member) => member.session_id === input.session_id,
		)!;
	}

	list_group_members(
		group_id_or_name: string,
	): CoordinationGroupMember[] {
		const group = this.get_group(group_id_or_name);
		if (!group) return [];
		return (
			this.statements.list_group_members.all(
				group.group_id,
			) as unknown as GroupMemberRow[]
		).map((row) => this.map_group_member(row));
	}

	list_group_memberships(
		session_id: string,
	): CoordinationGroupMembership[] {
		return (
			this.statements.list_group_memberships.all(
				session_id,
			) as unknown as GroupMembershipRow[]
		).map((row) => ({
			...this.map_group_member(row),
			group_name: row.group_name,
			group_cwd: optional(row.group_cwd),
		}));
	}

	send_message(input: CoordinationMessageInput): CoordinationMessage {
		if (!input.body.trim())
			throw new Error('Message body is required');
		const recipients = [...new Set(input.to_session_ids)].filter(
			(session_id) => session_id !== input.from_session_id,
		);
		if (recipients.length === 0)
			throw new Error('No message recipients');
		const timestamp = now();
		const message_id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
		const expires_at = input.ttl_ms
			? new Date(Date.now() + input.ttl_ms).toISOString()
			: null;
		this.transaction(() => {
			this.statements.insert_message.run(
				message_id,
				input.from_session_id,
				input.scope,
				input.target,
				input.body.trim(),
				input.urgent ? 1 : 0,
				input.reply_to ?? null,
				expires_at,
				input.requires_ack ? 1 : 0,
				timestamp,
				json(input.metadata ?? {}),
			);
			for (const session_id of recipients) {
				this.statements.insert_message_receipt.run(
					message_id,
					session_id,
					timestamp,
				);
			}
			this.insert_event({
				type: 'message_sent',
				session_id: input.from_session_id,
				message_id,
				data: {
					scope: input.scope,
					target: input.target,
					recipients,
				},
			});
		});
		return this.list_message_by_id(message_id)!;
	}

	send_to_session_target(
		input: Omit<CoordinationMessageInput, 'to_session_ids' | 'scope'>,
	): CoordinationMessage {
		const targets = this.resolve_session_targets(input.target);
		if (targets.length === 0) {
			const suggestions = this.list_sessions()
				.filter(
					(session) =>
						session.session_id.includes(input.target) ||
						session.agent_name?.includes(input.target),
				)
				.map((session) => session.session_id);
			throw new Error(
				`Unknown session target: ${input.target}${suggestions.length ? `. Matching sessions: ${suggestions.join(', ')}` : ''}`,
			);
		}
		return this.send_message({
			...input,
			scope: 'session',
			to_session_ids: targets.map((session) => session.session_id),
		});
	}

	send_to_group(
		input: Omit<CoordinationMessageInput, 'to_session_ids' | 'scope'>,
	): CoordinationMessage {
		const group = this.get_group(input.target);
		if (!group) throw new Error(`Unknown group: ${input.target}`);
		const members = this.list_group_members(group.group_id).filter(
			(member) => member.status === 'active',
		);
		return this.send_message({
			...input,
			target: group.group_id,
			scope: 'group',
			to_session_ids: members.map((member) => member.session_id),
		});
	}

	list_inbox(
		session_id: string,
		options: {
			include_read?: boolean;
			include_acknowledged?: boolean;
			undelivered_only?: boolean;
		} = {},
	): CoordinationInboxMessage[] {
		const rows = this.statements.list_inbox.all(
			session_id,
		) as unknown as InboxRow[];
		const timestamp = Date.now();
		return rows
			.map((row) => this.map_inbox(row))
			.filter((message) => {
				if (
					message.expires_at &&
					Date.parse(message.expires_at) <= timestamp
				)
					return false;
				if (options.undelivered_only && message.delivered_at)
					return false;
				if (!options.include_read && message.read_at) return false;
				if (!options.include_acknowledged && message.acknowledged_at)
					return false;
				return true;
			});
	}

	mark_messages_delivered(
		session_id: string,
		message_ids: string[],
	): void {
		this.mark_receipts(
			this.statements.mark_messages_delivered,
			session_id,
			message_ids,
		);
	}

	mark_messages_read(
		session_id: string,
		message_ids: string[],
	): void {
		this.mark_receipts(
			this.statements.mark_messages_read,
			session_id,
			message_ids,
		);
	}

	mark_messages_acknowledged(
		session_id: string,
		message_ids: string[],
	): void {
		this.mark_receipts(
			this.statements.mark_messages_acknowledged,
			session_id,
			message_ids,
		);
	}

	insert_event(input: {
		type: string;
		session_id?: string;
		group_id?: string;
		message_id?: string;
		data?: Record<string, unknown>;
	}): void {
		this.statements.insert_event.run(
			randomUUID(),
			input.type,
			input.session_id ?? null,
			input.group_id ?? null,
			input.message_id ?? null,
			now(),
			json(input.data ?? {}),
		);
	}

	get_schema_version(): number {
		return get_user_version(this.db);
	}

	read_rows<T>(query: string): T[] {
		return this.db.prepare(query).all() as T[];
	}

	close(): void {
		this.db.close();
	}

	private mark_receipts(
		statement: StatementSync,
		session_id: string,
		message_ids: string[],
	): void {
		if (message_ids.length === 0) return;
		const timestamp = now();
		this.transaction(() => {
			for (const message_id of message_ids)
				statement.run(timestamp, message_id, session_id);
		});
	}

	private list_message_by_id(
		message_id: string,
	): CoordinationMessage | undefined {
		const row = this.db
			.prepare('SELECT * FROM messages WHERE message_id = ?')
			.get(message_id) as
			| Omit<
					InboxRow,
					| 'to_session_id'
					| 'delivered_at'
					| 'read_at'
					| 'acknowledged_at'
					| 'receipt_created_at'
					| 'from_agent_name'
					| 'from_cwd'
			  >
			| undefined;
		if (!row) return undefined;
		return {
			message_id: row.message_id,
			from_session_id: row.from_session_id,
			scope: row.scope,
			target: row.target,
			body: row.body,
			urgent: bool(row.urgent),
			reply_to: optional(row.reply_to),
			expires_at: optional(row.expires_at),
			requires_ack: bool(row.requires_ack),
			created_at: row.created_at,
			metadata: parse_json(row.metadata_json, {}),
		};
	}

	private apply_migrations(): void {
		const current_version = get_user_version(this.db);
		if (current_version > LATEST_TEAM_SCHEMA_VERSION) {
			this.db.close();
			throw new Error(
				`Team coordination database schema version ${current_version} is newer than supported version ${LATEST_TEAM_SCHEMA_VERSION}`,
			);
		}
		if (current_version === 0) {
			this.db.exec('BEGIN');
			try {
				this.db.exec(SCHEMA);
				this.db.exec(
					`PRAGMA user_version = ${LATEST_TEAM_SCHEMA_VERSION}`,
				);
				this.db.exec('COMMIT');
			} catch (error) {
				this.db.exec('ROLLBACK');
				throw error;
			}
			return;
		}
		for (
			let next_version = current_version + 1;
			next_version <= LATEST_TEAM_SCHEMA_VERSION;
			next_version++
		) {
			const migration = MIGRATIONS[next_version];
			if (!migration)
				throw new Error(
					`Missing team coordination migration ${next_version}`,
				);
			this.db.exec('BEGIN');
			try {
				this.db.exec(migration);
				this.db.exec(`PRAGMA user_version = ${next_version}`);
				this.db.exec('COMMIT');
			} catch (error) {
				this.db.exec('ROLLBACK');
				throw error;
			}
		}
	}

	private transaction(fn: () => void): void {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			fn();
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	private prepare_statements(): TeamDatabaseStatements {
		return {
			register_session: this.db.prepare(`
				INSERT INTO sessions
				(session_id, session_file, cwd, agent_name, pid, role, status, model_provider, model_id, thinking_level, pool, tags_json, metadata_json, created_at, updated_at, last_seen_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
					pool = excluded.pool,
					tags_json = excluded.tags_json,
					metadata_json = excluded.metadata_json,
					updated_at = excluded.updated_at,
					last_seen_at = excluded.last_seen_at,
					offline_at = NULL
			`),
			get_session: this.db.prepare(
				'SELECT * FROM sessions WHERE session_id = ?',
			),
			list_sessions: this.db.prepare(
				'SELECT * FROM sessions ORDER BY last_seen_at DESC',
			),
			list_online_sessions: this.db.prepare(
				"SELECT * FROM sessions WHERE status != 'offline' ORDER BY last_seen_at DESC",
			),
			resolve_session_target: this.db.prepare(
				"SELECT * FROM sessions WHERE status != 'offline' AND (session_id = ? OR agent_name = ?) ORDER BY last_seen_at DESC",
			),
			mark_session_status: this.db.prepare(`
				UPDATE sessions
				SET status = ?, updated_at = ?, last_seen_at = ?, offline_at = ?
				WHERE session_id = ?
			`),
			insert_group: this.db.prepare(`
				INSERT INTO groups (group_id, name, cwd, created_by_session_id, created_at, updated_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`),
			get_group: this.db.prepare(
				'SELECT * FROM groups WHERE group_id = ?',
			),
			find_group_by_name: this.db.prepare(
				'SELECT * FROM groups WHERE name = ? ORDER BY updated_at DESC LIMIT 1',
			),
			list_groups: this.db.prepare(
				'SELECT * FROM groups ORDER BY updated_at DESC',
			),
			upsert_group_member: this.db.prepare(`
				INSERT INTO group_members (group_id, session_id, alias, role, status, joined_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(group_id, session_id) DO UPDATE SET
					alias = excluded.alias,
					role = excluded.role,
					status = excluded.status,
					updated_at = excluded.updated_at
			`),
			list_group_members: this.db.prepare(
				'SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at ASC',
			),
			list_group_memberships: this.db.prepare(`
				SELECT group_members.*, groups.name AS group_name, groups.cwd AS group_cwd
				FROM group_members
				JOIN groups ON groups.group_id = group_members.group_id
				WHERE group_members.session_id = ? AND group_members.status = 'active'
				ORDER BY groups.updated_at DESC
			`),
			insert_message: this.db.prepare(`
				INSERT INTO messages
				(message_id, from_session_id, scope, target, body, urgent, reply_to, expires_at, requires_ack, created_at, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),
			insert_message_receipt: this.db.prepare(`
				INSERT OR IGNORE INTO message_receipts (message_id, to_session_id, created_at)
				VALUES (?, ?, ?)
			`),
			list_inbox: this.db.prepare(`
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
			mark_messages_delivered: this.db.prepare(`
				UPDATE message_receipts SET delivered_at = COALESCE(delivered_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
			mark_messages_read: this.db.prepare(`
				UPDATE message_receipts SET read_at = COALESCE(read_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
			mark_messages_acknowledged: this.db.prepare(`
				UPDATE message_receipts SET acknowledged_at = COALESCE(acknowledged_at, ?)
				WHERE message_id = ? AND to_session_id = ?
			`),
			insert_event: this.db.prepare(`
				INSERT INTO events (event_id, type, session_id, group_id, message_id, created_at, data_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`),
		};
	}

	private map_session(row: SessionRow): CoordinationSession {
		return {
			session_id: row.session_id,
			session_file: optional(row.session_file),
			cwd: row.cwd,
			agent_name: optional(row.agent_name),
			pid: optional(row.pid),
			role: row.role,
			status: row.status,
			model_provider: optional(row.model_provider),
			model_id: optional(row.model_id),
			thinking_level: optional(row.thinking_level),
			pool: row.pool,
			tags: parse_json(row.tags_json, []),
			metadata: parse_json(row.metadata_json, {}),
			created_at: row.created_at,
			updated_at: row.updated_at,
			last_seen_at: row.last_seen_at,
			offline_at: optional(row.offline_at),
		};
	}

	private map_group(row: GroupRow): CoordinationGroup {
		return {
			group_id: row.group_id,
			name: row.name,
			cwd: optional(row.cwd),
			created_by_session_id: optional(row.created_by_session_id),
			created_at: row.created_at,
			updated_at: row.updated_at,
			next_task_id: row.next_task_id,
			metadata: parse_json(row.metadata_json, {}),
		};
	}

	private map_group_member(
		row: GroupMemberRow,
	): CoordinationGroupMember {
		return {
			group_id: row.group_id,
			session_id: row.session_id,
			alias: optional(row.alias),
			role: row.role,
			status: row.status,
			joined_at: row.joined_at,
			updated_at: row.updated_at,
		};
	}

	private map_inbox(row: InboxRow): CoordinationInboxMessage {
		return {
			message_id: row.message_id,
			from_session_id: row.from_session_id,
			scope: row.scope,
			target: row.target,
			body: row.body,
			urgent: bool(row.urgent),
			reply_to: optional(row.reply_to),
			expires_at: optional(row.expires_at),
			requires_ack: bool(row.requires_ack),
			created_at: row.created_at,
			metadata: parse_json(row.metadata_json, {}),
			to_session_id: row.to_session_id,
			delivered_at: optional(row.delivered_at),
			read_at: optional(row.read_at),
			acknowledged_at: optional(row.acknowledged_at),
			receipt_created_at: row.receipt_created_at,
			from_agent_name: optional(row.from_agent_name),
			from_cwd: optional(row.from_cwd),
		};
	}
}
