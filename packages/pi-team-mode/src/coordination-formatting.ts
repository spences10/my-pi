import type {
	CoordinationGroup,
	CoordinationGroupMember,
	CoordinationInboxMessage,
	CoordinationSession,
} from './db.js';

function short_id(id: string): string {
	return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

export function format_sessions(
	sessions: CoordinationSession[],
): string {
	if (sessions.length === 0) return 'No registered sessions.';
	return sessions
		.map((session) => {
			const name = session.agent_name ? ` ${session.agent_name}` : '';
			const model = session.model_id ? ` · ${session.model_id}` : '';
			return `- ${short_id(session.session_id)}${name} — ${session.status}; ${session.cwd}${model}`;
		})
		.join('\n');
}

export function format_inbox(
	messages: CoordinationInboxMessage[],
): string {
	if (messages.length === 0) return 'No matching inbox messages.';
	return messages
		.map((message) => {
			const from =
				message.from_agent_name ?? short_id(message.from_session_id);
			const states = [
				message.delivered_at ? 'delivered' : 'undelivered',
				message.read_at ? 'read' : undefined,
				message.acknowledged_at ? 'acknowledged' : undefined,
			]
				.filter(Boolean)
				.join(', ');
			return `- ${message.message_id} from ${from} (${states}): ${message.body}`;
		})
		.join('\n');
}

export function format_groups(
	groups: CoordinationGroup[],
	members_by_group: Map<
		string,
		CoordinationGroupMember[]
	> = new Map(),
): string {
	if (groups.length === 0) return 'No coordination groups.';
	return groups
		.map((group) => {
			const members = members_by_group.get(group.group_id) ?? [];
			const member_text = members.length
				? ` · ${members.length} member${members.length === 1 ? '' : 's'}`
				: '';
			return `- ${group.name} (${group.group_id})${member_text}${group.cwd ? ` · ${group.cwd}` : ''}`;
		})
		.join('\n');
}

export function format_peer_message_for_injection(
	own_session_id: string,
	messages: CoordinationInboxMessage[],
): string {
	return [
		`You have ${messages.length} coordination message${messages.length === 1 ? '' : 's'} for session ${own_session_id}:`,
		'',
		...messages.flatMap((message) => [
			`Message ${message.message_id} from ${message.from_agent_name ?? message.from_session_id}${message.requires_ack ? ' (ack required)' : ''}:`,
			message.body,
			'',
		]),
		'Use the team tool session_read after reviewing and session_ack after acting on messages that are complete.',
	].join('\n');
}
