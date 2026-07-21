import type { StatementSync } from 'node:sqlite';

export type DatabaseSyncConstructor =
	typeof import('node:sqlite').DatabaseSync;

export type CoordinationSessionAvailability =
	| 'available'
	| 'busy'
	| 'standby'
	| 'handoff'
	| 'offline';
export type CoordinationArtifactKind =
	| 'summary'
	| 'handoff'
	| 'plan'
	| 'evidence'
	| 'result'
	| 'log'
	| 'diff';

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
	availability?: CoordinationSessionAvailability;
	intent?: string;
	session_alias?: string;
	parent_session_id?: string;
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
	availability: CoordinationSessionAvailability;
	intent?: string;
	session_alias?: string;
	parent_session_id?: string;
	pool: string;
	tags: string[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	last_seen_at: string;
	offline_at?: string;
}

export interface CoordinationArtifact {
	artifact_id: string;
	kind: CoordinationArtifactKind;
	owner_session_id: string;
	cwd: string;
	title: string;
	summary: string;
	body: string;
	body_format: string;
	created_at: string;
	updated_at: string;
	metadata: Record<string, unknown>;
}

export interface CoordinationArtifactInput {
	kind: CoordinationArtifactKind;
	owner_session_id: string;
	cwd: string;
	title: string;
	summary: string;
	body: string;
	body_format?: string;
	metadata?: Record<string, unknown>;
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

export interface CoordinationCleanupOptions {
	retention_ms?: number;
	reference_time?: Date;
}

export interface CoordinationCleanupResult {
	cutoff: string;
	artifacts: number;
	events: number;
	groups: number;
	messages: number;
	receipts: number;
	sessions: number;
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

export interface SessionRow {
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
	availability: CoordinationSessionAvailability;
	intent: string | null;
	session_alias: string | null;
	parent_session_id: string | null;
	pool: string;
	tags_json: string;
	metadata_json: string;
	created_at: string;
	updated_at: string;
	last_seen_at: string;
	offline_at: string | null;
}

export interface ArtifactRow {
	artifact_id: string;
	kind: CoordinationArtifactKind;
	owner_session_id: string;
	cwd: string;
	title: string;
	summary: string;
	body: string;
	body_format: string;
	created_at: string;
	updated_at: string;
	metadata_json: string;
}

export interface GroupRow {
	group_id: string;
	name: string;
	cwd: string | null;
	created_by_session_id: string | null;
	created_at: string;
	updated_at: string;
	next_task_id: number;
	metadata_json: string;
}

export interface GroupMemberRow {
	group_id: string;
	session_id: string;
	alias: string | null;
	role: CoordinationGroupRole;
	status: 'active' | 'inactive';
	joined_at: string;
	updated_at: string;
}

export interface GroupMembershipRow extends GroupMemberRow {
	group_name: string;
	group_cwd: string | null;
}

export interface InboxRow {
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
	update_session_agent_name: StatementSync;
	mark_session_status: StatementSync;
	insert_artifact: StatementSync;
	get_artifact: StatementSync;
	list_artifacts: StatementSync;
	search_artifacts: StatementSync;
	insert_group: StatementSync;
	get_group: StatementSync;
	find_groups_by_name: StatementSync;
	find_groups_by_name_cwd: StatementSync;
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
	count_prunable_receipts: StatementSync;
	prune_events: StatementSync;
	prune_messages: StatementSync;
	prune_artifacts: StatementSync;
	prune_groups: StatementSync;
	prune_sessions: StatementSync;
}
