import type {
	ArtifactRow,
	CoordinationArtifact,
	CoordinationGroup,
	CoordinationGroupMember,
	CoordinationInboxMessage,
	CoordinationSession,
	GroupMemberRow,
	GroupRow,
	InboxRow,
	SessionRow,
} from './types.js';
import { bool, optional, parse_json } from './util.js';

export function map_session(row: SessionRow): CoordinationSession {
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
		availability: row.availability,
		intent: optional(row.intent),
		session_alias: optional(row.session_alias),
		parent_session_id: optional(row.parent_session_id),
		pool: row.pool,
		tags: parse_json(row.tags_json, []),
		metadata: parse_json(row.metadata_json, {}),
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_seen_at: row.last_seen_at,
		offline_at: optional(row.offline_at),
	};
}

export function map_artifact(row: ArtifactRow): CoordinationArtifact {
	return {
		artifact_id: row.artifact_id,
		kind: row.kind,
		owner_session_id: row.owner_session_id,
		cwd: row.cwd,
		title: row.title,
		summary: row.summary,
		body: row.body,
		body_format: row.body_format,
		created_at: row.created_at,
		updated_at: row.updated_at,
		metadata: parse_json(row.metadata_json, {}),
	};
}

export function map_group(row: GroupRow): CoordinationGroup {
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

export function map_group_member(
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

export function map_inbox(row: InboxRow): CoordinationInboxMessage {
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
