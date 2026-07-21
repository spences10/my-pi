import {
	with_sqlite_busy_retry,
	with_sqlite_transaction,
} from '@spences10/pi-sqlite-core';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { DEFAULT_MANUAL_COORDINATION_RETENTION_MS } from '../retention.js';
import {
	find_stale_sessions,
	type ProcessAliveCheck,
} from '../session-liveness.js';
import {
	map_artifact,
	map_group,
	map_group_member,
	map_inbox,
	map_session,
} from './mappers.js';
import { apply_migrations } from './migrate.js';
import { CONNECTION_PRAGMAS, PERSISTENT_PRAGMAS } from './schema.js';
import { prepare_statements } from './statements.js';
import type {
	ArtifactRow,
	CoordinationArtifact,
	CoordinationCleanupOptions,
	CoordinationCleanupResult,
	CoordinationArtifactInput,
	CoordinationArtifactKind,
	CoordinationGroup,
	CoordinationGroupMember,
	CoordinationGroupMembership,
	CoordinationGroupRole,
	CoordinationInboxMessage,
	CoordinationMessage,
	CoordinationMessageInput,
	CoordinationSession,
	CoordinationSessionInput,
	CoordinationSessionStatus,
	DatabaseSyncConstructor,
	GroupMemberRow,
	GroupMembershipRow,
	GroupRow,
	InboxRow,
	SessionRow,
	TeamDatabaseStatements,
} from './types.js';
import {
	bool,
	get_user_version,
	json,
	now,
	optional,
	parse_json,
} from './util.js';
export { LATEST_TEAM_SCHEMA_VERSION } from './schema.js';
export type {
	CoordinationArtifact,
	CoordinationCleanupOptions,
	CoordinationCleanupResult,
	CoordinationArtifactInput,
	CoordinationArtifactKind,
	CoordinationGroup,
	CoordinationGroupMember,
	CoordinationGroupMembership,
	CoordinationGroupRole,
	CoordinationInboxMessage,
	CoordinationMessage,
	CoordinationMessageInput,
	CoordinationRole,
	CoordinationSession,
	CoordinationSessionAvailability,
	CoordinationSessionInput,
	CoordinationSessionStatus,
	CoordinationTaskStatus,
} from './types.js';

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
		apply_migrations(this.db);
		this.statements = prepare_statements(this.db);
	}

	register_session(
		input: CoordinationSessionInput,
	): CoordinationSession {
		const timestamp = now();
		const existing = this.get_session(input.session_id);
		this.write(() =>
			this.statements.register_session.run(
				input.session_id,
				input.session_file ?? existing?.session_file ?? null,
				input.cwd,
				input.agent_name ?? existing?.agent_name ?? null,
				input.pid ?? existing?.pid ?? null,
				input.role ?? existing?.role ?? 'peer',
				input.status ?? 'online',
				input.model_provider ?? existing?.model_provider ?? null,
				input.model_id ?? existing?.model_id ?? null,
				input.thinking_level ?? existing?.thinking_level ?? null,
				input.availability ?? existing?.availability ?? 'available',
				input.intent ?? existing?.intent ?? null,
				input.session_alias ?? existing?.session_alias ?? null,
				input.parent_session_id ??
					existing?.parent_session_id ??
					null,
				input.pool ?? existing?.pool ?? 'default',
				json(input.tags ?? existing?.tags ?? []),
				json({
					...existing?.metadata,
					...input.metadata,
				}),
				timestamp,
				timestamp,
				timestamp,
			),
		);
		return this.get_session(input.session_id)!;
	}

	get_session(session_id: string): CoordinationSession | undefined {
		const row = this.statements.get_session.get(session_id) as
			| SessionRow
			| undefined;
		return row ? map_session(row) : undefined;
	}

	list_sessions(
		options: { include_offline?: boolean } = {},
	): CoordinationSession[] {
		const rows = (options.include_offline
			? this.statements.list_sessions.all()
			: this.statements.list_online_sessions.all()) as unknown as SessionRow[];
		return rows.map((row) => map_session(row));
	}

	mark_stale_sessions_offline(
		is_alive?: ProcessAliveCheck,
	): string[] {
		const sessions = (
			this.statements.list_online_sessions.all() as unknown as SessionRow[]
		).map((row) => map_session(row));
		const stale = find_stale_sessions(sessions, is_alive);
		for (const session of stale)
			this.mark_session_status(session.session_id, 'offline');
		return stale.map((session) => session.session_id);
	}

	resolve_session_targets(target: string): CoordinationSession[] {
		const targetable_sessions = (
			this.statements.list_sessions.all() as unknown as SessionRow[]
		).map((row) => map_session(row));
		const exact_session_id = targetable_sessions.filter(
			(session) => session.session_id === target,
		);
		if (exact_session_id.length > 0) return exact_session_id;

		const exact_named = targetable_sessions.filter(
			(session) =>
				session.agent_name === target ||
				session.session_alias === target,
		);
		if (exact_named.length === 1) return exact_named;
		if (exact_named.length > 1) {
			const active_named = exact_named.filter(
				(session) => session.status !== 'offline',
			);
			if (active_named.length === 1) return active_named;
			throw new Error(
				`Ambiguous session target: ${target}. Matching sessions: ${exact_named
					.map((session) => session.session_id)
					.join(', ')}`,
			);
		}

		const prefix_matches = targetable_sessions.filter((session) =>
			session.session_id.startsWith(target),
		);
		if (prefix_matches.length <= 1) return prefix_matches;

		throw new Error(
			`Ambiguous session target: ${target}. Matching sessions: ${prefix_matches
				.map((session) => session.session_id)
				.join(', ')}`,
		);
	}

	update_session_agent_name(
		session_id: string,
		agent_name: string | undefined,
	): void {
		const timestamp = now();
		this.write(() =>
			this.statements.update_session_agent_name.run(
				agent_name ?? null,
				timestamp,
				timestamp,
				session_id,
			),
		);
	}

	mark_session_status(
		session_id: string,
		status: CoordinationSessionStatus,
	): void {
		const timestamp = now();
		this.write(() =>
			this.statements.mark_session_status.run(
				status,
				timestamp,
				timestamp,
				status === 'offline' ? timestamp : null,
				status,
				session_id,
			),
		);
	}

	heartbeat_session(session_id: string): void {
		this.mark_session_status(session_id, 'online');
	}

	create_artifact(
		input: CoordinationArtifactInput,
	): CoordinationArtifact {
		if (!input.title.trim())
			throw new Error('Artifact title is required');
		if (!input.summary.trim())
			throw new Error('Artifact summary is required');
		if (!input.body.trim())
			throw new Error('Artifact body is required');
		const timestamp = now();
		const artifact_id = `artifact_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
		this.write(() =>
			this.statements.insert_artifact.run(
				artifact_id,
				input.kind,
				input.owner_session_id,
				input.cwd,
				input.title.trim(),
				input.summary.trim(),
				input.body.trim(),
				input.body_format ?? 'markdown',
				timestamp,
				timestamp,
				json(input.metadata ?? {}),
			),
		);
		return this.get_artifact(artifact_id)!;
	}

	get_artifact(
		artifact_id: string,
	): CoordinationArtifact | undefined {
		const row = this.statements.get_artifact.get(artifact_id) as
			| ArtifactRow
			| undefined;
		return row ? map_artifact(row) : undefined;
	}

	list_artifacts(
		options: { cwd?: string; kind?: CoordinationArtifactKind } = {},
	): CoordinationArtifact[] {
		const cwd = options.cwd ?? null;
		const kind = options.kind ?? null;
		const rows = this.statements.list_artifacts.all(
			cwd,
			cwd,
			kind,
			kind,
		) as unknown as ArtifactRow[];
		return rows.map((row) => map_artifact(row));
	}

	search_artifacts(
		query: string,
		options: { cwd?: string } = {},
	): CoordinationArtifact[] {
		const pattern = `%${query.trim()}%`;
		const cwd = options.cwd ?? null;
		const rows = this.statements.search_artifacts.all(
			cwd,
			cwd,
			pattern,
			pattern,
			pattern,
		) as unknown as ArtifactRow[];
		return rows.map((row) => map_artifact(row));
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
			.replace(
				/[^a-z0-9_.-]+/g,
				'-',
			)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
		this.write(() =>
			this.statements.insert_group.run(
				group_id,
				input.name.trim(),
				input.cwd ?? null,
				input.created_by_session_id ?? null,
				timestamp,
				timestamp,
				json(input.metadata ?? {}),
			),
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

	get_group(
		group_id_or_name: string,
		options: { cwd?: string } = {},
	): CoordinationGroup | undefined {
		const exact = this.statements.get_group.get(group_id_or_name) as
			| GroupRow
			| undefined;
		if (exact) return map_group(exact);

		const rows = (options.cwd
			? this.statements.find_groups_by_name_cwd.all(
					group_id_or_name,
					options.cwd,
				)
			: this.statements.find_groups_by_name.all(
					group_id_or_name,
				)) as unknown as GroupRow[];
		if (rows.length === 0) return undefined;
		if (rows.length === 1) return map_group(rows[0]!);
		throw new Error(
			`Ambiguous group target: ${group_id_or_name}. Matching groups: ${rows
				.map((row) => `${row.group_id} (${row.cwd ?? 'no cwd'})`)
				.join(', ')}`,
		);
	}

	list_groups(): CoordinationGroup[] {
		return (
			this.statements.list_groups.all() as unknown as GroupRow[]
		).map((row) => map_group(row));
	}

	add_group_member(input: {
		group_id: string;
		session_id: string;
		alias?: string;
		role?: CoordinationGroupRole;
	}): CoordinationGroupMember {
		const timestamp = now();
		this.write(() =>
			this.statements.upsert_group_member.run(
				input.group_id,
				input.session_id,
				input.alias ?? null,
				input.role ?? 'peer',
				'active',
				timestamp,
				timestamp,
			),
		);
		return this.list_group_members(input.group_id).find(
			(member) => member.session_id === input.session_id,
		)!;
	}

	list_group_members(
		group_id_or_name: string,
		options: { cwd?: string } = {},
	): CoordinationGroupMember[] {
		const group = this.get_group(group_id_or_name, options);
		if (!group) return [];
		return (
			this.statements.list_group_members.all(
				group.group_id,
			) as unknown as GroupMemberRow[]
		).map((row) => map_group_member(row));
	}

	list_group_memberships(
		session_id: string,
	): CoordinationGroupMembership[] {
		return (
			this.statements.list_group_memberships.all(
				session_id,
			) as unknown as GroupMembershipRow[]
		).map((row) => ({
			...map_group_member(row),
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
			const suggestions = this.list_sessions({
				include_offline: true,
			})
				.filter(
					(session) =>
						session.session_id.includes(input.target) ||
						session.agent_name?.includes(input.target) ||
						session.session_alias?.includes(input.target),
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
		options: { cwd?: string } = {},
	): CoordinationMessage {
		const group = this.get_group(input.target, options);
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
			.map((row) => map_inbox(row))
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

	prune_historical_data(
		options: CoordinationCleanupOptions = {},
	): CoordinationCleanupResult {
		const retention_ms =
			options.retention_ms ??
			DEFAULT_MANUAL_COORDINATION_RETENTION_MS;
		if (!Number.isFinite(retention_ms) || retention_ms < 0)
			throw new Error('Coordination retention must be non-negative');
		const reference_time = options.reference_time ?? new Date();
		if (Number.isNaN(reference_time.getTime()))
			throw new Error(
				'Coordination cleanup reference time is invalid',
			);
		const reference = reference_time.toISOString();
		const cutoff = new Date(
			reference_time.getTime() - retention_ms,
		).toISOString();
		const changes = (result: { changes: number | bigint }): number =>
			Number(result.changes);
		let cleanup_result: CoordinationCleanupResult | undefined;
		this.transaction(() => {
			const receipt_row = this.statements.count_prunable_receipts.get(
				reference,
				cutoff,
			) as { count: number | bigint };
			const events = changes(
				this.statements.prune_events.run(cutoff),
			);
			const messages = changes(
				this.statements.prune_messages.run(reference, cutoff),
			);
			const artifacts = changes(
				this.statements.prune_artifacts.run(cutoff),
			);
			const groups = changes(
				this.statements.prune_groups.run(cutoff, cutoff),
			);
			const sessions = changes(
				this.statements.prune_sessions.run(cutoff),
			);
			cleanup_result = {
				cutoff,
				artifacts,
				events,
				groups,
				messages,
				receipts: Number(receipt_row.count),
				sessions,
			};
		});
		return cleanup_result!;
	}

	insert_event(input: {
		type: string;
		session_id?: string;
		group_id?: string;
		message_id?: string;
		data?: Record<string, unknown>;
	}): void {
		this.write(() =>
			this.statements.insert_event.run(
				randomUUID(),
				input.type,
				input.session_id ?? null,
				input.group_id ?? null,
				input.message_id ?? null,
				now(),
				json(input.data ?? {}),
			),
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

	private write<T>(fn: () => T): T {
		return with_sqlite_busy_retry(fn, {
			operation: 'Update team coordination database',
		});
	}

	private transaction<T>(fn: () => T): T {
		return with_sqlite_transaction(this.db, fn, {
			immediate: true,
			operation: 'Update team coordination database',
		});
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
}
