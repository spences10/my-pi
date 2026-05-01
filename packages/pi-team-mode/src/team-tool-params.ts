import { StringEnum } from '@mariozechner/pi-ai';
import { Type } from 'typebox';
import type { TeamTaskStatus, TeamWorkspaceMode } from './store.js';

export type TeamUiMode = 'auto' | 'compact' | 'full' | 'off';
export type TeamUiStyle = 'plain' | 'badge' | 'color';

const TEAM_ACTIONS = [
	'team_create',
	'team_list',
	'team_status',
	'team_clear',
	'team_ui',
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

function team_action_params(
	action: TeamActionName,
	fields: Record<string, unknown> = {},
) {
	return Type.Object({
		action: Type.Literal(action),
		team_id: Type.Optional(Type.String()),
		...fields,
	});
}

function member_action_params(
	action: TeamActionName,
	fields: Record<string, unknown> = {},
) {
	return Type.Union([
		team_action_params(action, {
			member: Type.String(),
			name: Type.Optional(Type.String()),
			...fields,
		}),
		team_action_params(action, {
			name: Type.String(),
			member: Type.Optional(Type.String()),
			...fields,
		}),
	]);
}

export const TeamToolParams = Type.Union([
	team_action_params('team_create', {
		name: Type.Optional(Type.String()),
	}),
	team_action_params('team_list'),
	team_action_params('team_status'),
	team_action_params('team_clear'),
	team_action_params('team_ui', {
		mode: Type.Optional(TeamUiModeParam),
		style: Type.Optional(TeamUiStyleParam),
	}),
	member_action_params('member_upsert', {
		role: Type.Optional(TeamRole),
		status: Type.Optional(TeamMemberStatus),
	}),
	member_action_params('member_spawn', {
		initial_prompt: Type.Optional(Type.String()),
		model: Type.Optional(Type.String()),
		thinking: Type.Optional(Type.String()),
		profile: Type.Optional(Type.String()),
		agent: Type.Optional(Type.String()),
		workspace_mode: Type.Optional(TeamWorkspaceModeParam),
		branch: Type.Optional(Type.String()),
		worktree_path: Type.Optional(Type.String()),
		mutating: Type.Optional(Type.Boolean()),
		force: Type.Optional(Type.Boolean()),
	}),
	member_action_params('member_prompt', {
		message: Type.Optional(Type.String()),
		initial_prompt: Type.Optional(Type.String()),
	}),
	member_action_params('member_follow_up', {
		message: Type.Optional(Type.String()),
		initial_prompt: Type.Optional(Type.String()),
	}),
	member_action_params('member_steer', {
		message: Type.Optional(Type.String()),
		initial_prompt: Type.Optional(Type.String()),
	}),
	member_action_params('member_shutdown', {
		message: Type.Optional(Type.String()),
		timeout_ms: Type.Optional(Type.Number()),
	}),
	team_action_params('member_status'),
	member_action_params('member_wait', {
		timeout_ms: Type.Optional(Type.Number()),
	}),
	team_action_params('task_create', {
		title: Type.String(),
		description: Type.Optional(Type.String()),
		assignee: Type.Optional(Type.String()),
		depends_on: Type.Optional(Type.Array(Type.String())),
	}),
	team_action_params('task_list'),
	team_action_params('task_get', {
		task_id: Type.String(),
	}),
	team_action_params('task_update', {
		task_id: Type.String(),
		title: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		task_status: Type.Optional(TeamTaskStatusParam),
		assignee: Type.Optional(Type.String()),
		clear_assignee: Type.Optional(Type.Boolean()),
		depends_on: Type.Optional(Type.Array(Type.String())),
		result: Type.Optional(Type.String()),
		clear_result: Type.Optional(Type.Boolean()),
	}),
	team_action_params('task_claim_next', {
		assignee: Type.Optional(Type.String()),
		member: Type.Optional(Type.String()),
	}),
	team_action_params('message_send', {
		from: Type.Optional(Type.String()),
		to: Type.String(),
		message: Type.String(),
		urgent: Type.Optional(Type.Boolean()),
	}),
	team_action_params('message_list', {
		member: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
	}),
	team_action_params('message_read', {
		member: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
	}),
	team_action_params('message_ack', {
		member: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
	}),
]);

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
	urgent?: boolean;
	initial_prompt?: string;
	model?: string;
	thinking?: string;
	profile?: string;
	agent?: string;
	workspace_mode?: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
	mutating?: boolean;
	force?: boolean;
	timeout_ms?: number;
	mode?: TeamUiMode;
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
	switch (params.action) {
		case 'team_create':
		case 'team_list':
		case 'team_status':
		case 'team_clear':
		case 'team_ui':
		case 'member_status':
		case 'task_list':
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
		case 'message_read':
		case 'message_ack':
			require_tool_any_field(params, ['member', 'to'], 'member');
			return;
	}
}
