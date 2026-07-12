import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

export type TeamUiMode = 'auto' | 'compact' | 'full' | 'off';

export const TEAM_ACTIONS = [
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
	'message_send',
	'message_list',
	'message_wait',
	'message_read',
	'message_ack',
] as const;

export type TeamActionName = (typeof TEAM_ACTIONS)[number];

const CoordinationRoleParam = StringEnum([
	'lead',
	'teammate',
	'peer',
] as const);

const TeamUiModeParam = StringEnum([
	'auto',
	'compact',
	'full',
	'off',
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

export const TeamToolParams = Type.Object(
	{
		action: StringEnum(TEAM_ACTIONS),
		team_id: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		member: Type.Optional(Type.String()),
		role: Type.Optional(CoordinationRoleParam),
		from: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
		message: Type.Optional(Type.String()),
		message_ids: Type.Optional(Type.Array(Type.String())),
		reply_to: Type.Optional(Type.String()),
		ttl_ms: Type.Optional(Type.Number()),
		requires_ack: Type.Optional(Type.Boolean()),
		include_read: Type.Optional(Type.Boolean()),
		urgent: Type.Optional(Type.Boolean()),
		timeout_ms: Type.Optional(Type.Number()),
		mode: Type.Optional(TeamUiModeParam),
		kind: Type.Optional(ArtifactKindParam),
		title: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		body: Type.Optional(Type.String()),
		body_format: Type.Optional(Type.String()),
		query: Type.Optional(Type.String()),
		artifact_id: Type.Optional(Type.String()),
		message_id: Type.Optional(Type.String()),
		chunk_index: Type.Optional(Type.Number()),
		before: Type.Optional(Type.Number()),
		after: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

export type TeamToolParams = {
	action: TeamActionName;
	team_id?: string;
	name?: string;
	member?: string;
	role?: 'lead' | 'teammate' | 'peer';
	from?: string;
	to?: string;
	message?: string;
	message_ids?: string[];
	reply_to?: string;
	ttl_ms?: number;
	requires_ack?: boolean;
	include_read?: boolean;
	urgent?: boolean;
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
	title?: string;
	description?: string;
	body?: string;
	body_format?: string;
	query?: string;
	artifact_id?: string;
	message_id?: string;
	chunk_index?: number;
	before?: number;
	after?: number;
};

const ACTION_ALLOWED_FIELDS = {
	session_list: ['action', 'include_read', 'mode'],
	session_send: [
		'action',
		'from',
		'to',
		'message',
		'reply_to',
		'ttl_ms',
		'requires_ack',
		'urgent',
		'timeout_ms',
	],
	session_inbox: [
		'action',
		'include_read',
		'mode',
		'message_id',
		'message_ids',
		'chunk_index',
		'before',
		'after',
	],
	session_read: ['action', 'message_ids', 'mode'],
	session_ack: ['action', 'message_ids', 'mode'],
	session_wait: [
		'action',
		'from',
		'timeout_ms',
		'include_read',
		'mode',
		'message_id',
		'message_ids',
		'chunk_index',
		'before',
		'after',
	],
	group_create: ['action', 'name'],
	group_list: ['action'],
	group_join: ['action', 'team_id', 'name', 'member', 'role'],
	group_add_session: [
		'action',
		'team_id',
		'name',
		'to',
		'member',
		'role',
	],
	group_send: [
		'action',
		'team_id',
		'name',
		'to',
		'message',
		'urgent',
		'reply_to',
		'ttl_ms',
		'requires_ack',
	],
	artifact_create: [
		'action',
		'kind',
		'title',
		'description',
		'body',
		'body_format',
	],
	artifact_get: [
		'action',
		'artifact_id',
		'mode',
		'chunk_index',
		'before',
		'after',
	],
	artifact_list: ['action', 'query', 'kind'],
	message_send: [
		'action',
		'from',
		'to',
		'message',
		'reply_to',
		'ttl_ms',
		'requires_ack',
		'urgent',
		'timeout_ms',
	],
	message_list: [
		'action',
		'include_read',
		'mode',
		'message_id',
		'message_ids',
		'chunk_index',
		'before',
		'after',
	],
	message_wait: [
		'action',
		'from',
		'timeout_ms',
		'include_read',
		'mode',
		'message_id',
		'message_ids',
		'chunk_index',
		'before',
		'after',
	],
	message_read: ['action', 'message_ids', 'mode'],
	message_ack: ['action', 'message_ids', 'mode'],
} as const satisfies Record<
	TeamActionName,
	readonly (keyof TeamToolParams)[]
>;

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

function reject_inapplicable_fields(params: TeamToolParams): void {
	const allowed = ACTION_ALLOWED_FIELDS[params.action];
	if (!allowed)
		throw new Error(
			`Unsupported team action: ${String(params.action)}`,
		);
	const allowed_fields = new Set<string>(allowed);
	const invalid = Object.keys(params).filter(
		(field) => !allowed_fields.has(field),
	);
	if (invalid.length > 0) {
		throw new Error(
			`Invalid team tool action ${params.action}: field ${invalid[0]} is not allowed`,
		);
	}
}

export function validate_team_tool_params(
	params: TeamToolParams,
): void {
	reject_inapplicable_fields(params);
	switch (params.action) {
		case 'session_list':
		case 'session_inbox':
		case 'session_read':
		case 'session_ack':
		case 'session_wait':
		case 'group_list':
		case 'artifact_list':
		case 'message_list':
		case 'message_wait':
		case 'message_read':
		case 'message_ack':
			return;
		case 'session_send':
		case 'message_send':
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
	}
}
