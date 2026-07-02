import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import {
	parse_team_thinking_level,
	type TeamThinkingLevel,
} from './command-parser.js';
import type { TeamTaskStatus, TeamWorkspaceMode } from './store.js';

export type TeamUiMode = 'auto' | 'compact' | 'full' | 'off';
export type TeamUiStyle = 'plain' | 'badge' | 'color';

const TEAM_ACTIONS = [
	'team_create',
	'team_list',
	'team_status',
	'team_clear',
	'team_shutdown',
	'team_ui',
	'session_list',
	'session_send',
	'session_inbox',
	'session_read',
	'session_ack',
	'session_wait',
	'group_create',
	'group_list',
	'group_join',
	'group_add_session',
	'group_send',
	'artifact_create',
	'artifact_get',
	'artifact_list',
	'member_upsert',
	'member_spawn',
	'member_prompt',
	'member_follow_up',
	'member_steer',
	'member_shutdown',
	'member_status',
	'member_wait',
	'task_create',
	'task_list',
	'task_get',
	'task_update',
	'task_claim_next',
	'message_send',
	'message_list',
	'message_wait',
	'message_read',
	'message_ack',
] as const;

export type TeamActionName = (typeof TEAM_ACTIONS)[number];

const TeamRole = StringEnum(['lead', 'teammate'] as const);
const TeamMemberStatus = StringEnum([
	'idle',
	'running',
	'running_attached',
	'running_orphaned',
	'blocked',
	'offline',
] as const);
const TeamTaskStatusParam = StringEnum([
	'pending',
	'in_progress',
	'blocked',
	'completed',
	'cancelled',
] as const);
const TeamWorkspaceModeParam = StringEnum([
	'shared',
	'worktree',
] as const);
const TeamUiModeParam = StringEnum([
	'auto',
	'compact',
	'full',
	'off',
] as const);
const TeamUiStyleParam = StringEnum([
	'plain',
	'badge',
	'color',
] as const);
const ArtifactKindParam = StringEnum([
	'summary',
	'handoff',
	'plan',
	'evidence',
	'result',
	'log',
	'diff',
] as const);

const TeamThinkingParam = StringEnum([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const);

export const TeamToolParams = Type.Object({
	action: StringEnum(TEAM_ACTIONS),
	team_id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	member: Type.Optional(Type.String()),
	role: Type.Optional(TeamRole),
	status: Type.Optional(TeamMemberStatus),
	title: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	task_id: Type.Optional(Type.String()),
	task_status: Type.Optional(TeamTaskStatusParam),
	assignee: Type.Optional(Type.String()),
	clear_assignee: Type.Optional(Type.Boolean()),
	depends_on: Type.Optional(Type.Array(Type.String())),
	result: Type.Optional(Type.String()),
	clear_result: Type.Optional(Type.Boolean()),
	from: Type.Optional(Type.String()),
	to: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	message_ids: Type.Optional(Type.Array(Type.String())),
	reply_to: Type.Optional(Type.String()),
	ttl_ms: Type.Optional(Type.Number()),
	requires_ack: Type.Optional(Type.Boolean()),
	include_read: Type.Optional(Type.Boolean()),
	urgent: Type.Optional(Type.Boolean()),
	initial_prompt: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(TeamThinkingParam),
	profile: Type.Optional(Type.String()),
	agent: Type.Optional(Type.String()),
	workspace_mode: Type.Optional(TeamWorkspaceModeParam),
	branch: Type.Optional(Type.String()),
	worktree_path: Type.Optional(Type.String()),
	mutating: Type.Optional(Type.Boolean()),
	force: Type.Optional(Type.Boolean()),
	timeout_ms: Type.Optional(Type.Number()),
	mode: Type.Optional(TeamUiModeParam),
	kind: Type.Optional(ArtifactKindParam),
	body: Type.Optional(Type.String()),
	body_format: Type.Optional(Type.String()),
	query: Type.Optional(Type.String()),
	artifact_id: Type.Optional(Type.String()),
	style: Type.Optional(TeamUiStyleParam),
});

export type TeamToolParams = {
	action: TeamActionName;
	team_id?: string;
	name?: string;
	member?: string;
	role?: 'lead' | 'teammate';
	status?:
		| 'idle'
		| 'running'
		| 'running_attached'
		| 'running_orphaned'
		| 'blocked'
		| 'offline';
	title?: string;
	description?: string;
	task_id?: string;
	task_status?: TeamTaskStatus;
	assignee?: string;
	clear_assignee?: boolean;
	depends_on?: string[];
	result?: string;
	clear_result?: boolean;
	from?: string;
	to?: string;
	message?: string;
	message_ids?: string[];
	reply_to?: string;
	ttl_ms?: number;
	requires_ack?: boolean;
	include_read?: boolean;
	urgent?: boolean;
	initial_prompt?: string;
	model?: string;
	thinking?: TeamThinkingLevel;
	profile?: string;
	agent?: string;
	workspace_mode?: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
	mutating?: boolean;
	force?: boolean;
	timeout_ms?: number;
	mode?: TeamUiMode;
	kind?:
		| 'summary'
		| 'handoff'
		| 'plan'
		| 'evidence'
		| 'result'
		| 'log'
		| 'diff';
	body?: string;
	body_format?: string;
	query?: string;
	artifact_id?: string;
	style?: TeamUiStyle;
};

function require_tool_field(
	params: TeamToolParams,
	field: keyof TeamToolParams,
): void {
	const value = params[field];
	if (typeof value === 'string' && value.trim()) return;
	throw new Error(
		`Invalid team tool action ${params.action}: missing required field ${field}`,
	);
}

function require_tool_any_field(
	params: TeamToolParams,
	fields: (keyof TeamToolParams)[],
	label: string,
): void {
	if (
		fields.some((field) => {
			const value = params[field];
			return typeof value === 'string' && value.trim();
		})
	) {
		return;
	}
	throw new Error(
		`Invalid team tool action ${params.action}: missing required field ${label}`,
	);
}

export function validate_team_tool_params(
	params: TeamToolParams,
): void {
	parse_team_thinking_level(params.thinking);
	switch (params.action) {
		case 'team_create':
		case 'team_list':
		case 'team_status':
		case 'team_clear':
		case 'team_shutdown':
		case 'team_ui':
		case 'member_status':
		case 'task_list':
		case 'session_list':
		case 'session_inbox':
		case 'session_read':
		case 'session_ack':
		case 'session_wait':
		case 'group_list':
			return;
		case 'session_send':
			require_tool_field(params, 'to');
			require_tool_field(params, 'message');
			return;
		case 'group_create':
			require_tool_field(params, 'name');
			return;
		case 'group_join':
			require_tool_any_field(params, ['team_id', 'name'], 'group');
			return;
		case 'group_add_session':
			require_tool_any_field(params, ['team_id', 'name'], 'group');
			require_tool_field(params, 'to');
			return;
		case 'group_send':
			require_tool_any_field(
				params,
				['team_id', 'name', 'to'],
				'group',
			);
			require_tool_field(params, 'message');
			return;
		case 'artifact_create':
			require_tool_field(params, 'kind');
			require_tool_field(params, 'title');
			require_tool_field(params, 'body');
			return;
		case 'artifact_get':
			require_tool_field(params, 'artifact_id');
			return;
		case 'artifact_list':
			return;
		case 'member_upsert':
		case 'member_spawn':
		case 'member_shutdown':
		case 'member_wait':
			require_tool_any_field(params, ['member', 'name'], 'member');
			return;
		case 'member_prompt':
		case 'member_follow_up':
		case 'member_steer':
			require_tool_any_field(params, ['member', 'name'], 'member');
			require_tool_any_field(
				params,
				['message', 'initial_prompt'],
				'message',
			);
			return;
		case 'task_create':
			require_tool_field(params, 'title');
			return;
		case 'task_get':
		case 'task_update':
			require_tool_field(params, 'task_id');
			return;
		case 'task_claim_next':
			require_tool_any_field(
				params,
				['assignee', 'member'],
				'assignee',
			);
			return;
		case 'message_send':
			require_tool_field(params, 'to');
			require_tool_field(params, 'message');
			return;
		case 'message_list':
		case 'message_wait':
		case 'message_read':
		case 'message_ack':
			require_tool_any_field(params, ['member', 'to'], 'member');
			return;
	}
}
