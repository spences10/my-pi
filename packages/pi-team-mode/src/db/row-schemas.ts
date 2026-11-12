import * as v from 'valibot';
import type {
	ArtifactRow,
	GroupMemberRow,
	GroupMembershipRow,
	GroupRow,
	InboxRow,
	SessionRow,
} from './types.js';

export const session_row_schema = v.object({
	session_id: v.string(),
	session_file: v.nullable(v.string()),
	cwd: v.string(),
	agent_name: v.nullable(v.string()),
	pid: v.nullable(v.number()),
	role: v.picklist(['peer', 'lead', 'teammate']),
	status: v.picklist([
		'online',
		'idle',
		'running',
		'blocked',
		'offline',
	]),
	model_provider: v.nullable(v.string()),
	model_id: v.nullable(v.string()),
	thinking_level: v.nullable(v.string()),
	availability: v.picklist([
		'available',
		'busy',
		'standby',
		'handoff',
		'offline',
	]),
	intent: v.nullable(v.string()),
	session_alias: v.nullable(v.string()),
	parent_session_id: v.nullable(v.string()),
	pool: v.string(),
	tags_json: v.string(),
	metadata_json: v.string(),
	created_at: v.string(),
	updated_at: v.string(),
	last_seen_at: v.string(),
	offline_at: v.nullable(v.string()),
}) satisfies v.GenericSchema<SessionRow>;

export const artifact_row_schema = v.object({
	artifact_id: v.string(),
	kind: v.picklist([
		'summary',
		'handoff',
		'plan',
		'evidence',
		'result',
		'log',
		'diff',
	]),
	owner_session_id: v.string(),
	cwd: v.string(),
	title: v.string(),
	summary: v.string(),
	body: v.string(),
	body_format: v.string(),
	created_at: v.string(),
	updated_at: v.string(),
	metadata_json: v.string(),
}) satisfies v.GenericSchema<ArtifactRow>;

export const group_row_schema = v.object({
	closed_at: v.nullable(v.string()),
	group_id: v.string(),
	name: v.string(),
	cwd: v.nullable(v.string()),
	created_by_session_id: v.nullable(v.string()),
	created_at: v.string(),
	updated_at: v.string(),
	next_task_id: v.number(),
	metadata_json: v.string(),
}) satisfies v.GenericSchema<GroupRow>;

export const group_member_row_schema = v.object({
	group_id: v.string(),
	session_id: v.string(),
	alias: v.nullable(v.string()),
	role: v.picklist(['lead', 'teammate', 'peer', 'reviewer']),
	status: v.picklist(['active', 'inactive']),
	joined_at: v.string(),
	updated_at: v.string(),
}) satisfies v.GenericSchema<GroupMemberRow>;

export const group_membership_row_schema = v.object({
	...group_member_row_schema.entries,
	group_name: v.string(),
	group_cwd: v.nullable(v.string()),
}) satisfies v.GenericSchema<GroupMembershipRow>;

export const inbox_row_schema = v.object({
	message_id: v.string(),
	from_session_id: v.string(),
	scope: v.picklist(['session', 'group', 'broadcast']),
	target: v.string(),
	body: v.string(),
	message_type: v.picklist(['action', 'status']),
	status_key: v.nullable(v.string()),
	idempotency_key: v.nullable(v.string()),
	request_hash: v.nullable(v.string()),
	urgent: v.number(),
	reply_to: v.nullable(v.string()),
	expires_at: v.nullable(v.string()),
	requires_ack: v.number(),
	created_at: v.string(),
	metadata_json: v.string(),
	to_session_id: v.string(),
	delivered_at: v.nullable(v.string()),
	read_at: v.nullable(v.string()),
	acknowledged_at: v.nullable(v.string()),
	receipt_created_at: v.string(),
	from_agent_name: v.nullable(v.string()),
	from_cwd: v.nullable(v.string()),
}) satisfies v.GenericSchema<InboxRow>;
