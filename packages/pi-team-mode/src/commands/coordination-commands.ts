import {
	format_groups,
	format_inbox,
	format_sessions,
} from '../coordination-formatting.js';
import type { TeamCommandDeps } from './types.js';

function require_session_id(deps: TeamCommandDeps): string {
	const session_id = deps.get_session_id?.();
	if (!session_id)
		throw new Error('Current session is not registered yet.');
	return session_id;
}

export async function handle_sessions(
	deps: TeamCommandDeps,
): Promise<void> {
	const sessions = deps.coordination_db.list_sessions();
	deps.ctx.ui.notify(format_sessions(sessions), 'info');
}

export async function handle_session_command(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [sub = 'list', ...tail] = rest;
	if (sub === 'list') {
		await handle_sessions(deps);
		return;
	}
	if (sub === 'send') {
		const [target, ...message_parts] = tail;
		if (!target || message_parts.length === 0)
			throw new Error(
				'Usage: /team session send <session-id-or-name> <message>',
			);
		const recipients = deps.coordination_db
			.resolve_session_targets(target)
			.map((session) => session.session_id);
		const message = deps.coordination_db.send_to_session_target({
			from_session_id: require_session_id(deps),
			target,
			body: message_parts.join(' '),
		});
		await deps.notify_coordination_messages(
			recipients,
			message.message_id,
		);
		deps.ctx.ui.notify(
			`Sent ${message.message_id} to ${target}`,
			'info',
		);
		return;
	}
	if (sub === 'inbox') {
		const messages = deps.coordination_db.list_inbox(
			require_session_id(deps),
			{
				include_read: tail.includes('--all'),
				include_acknowledged: tail.includes('--all'),
			},
		);
		deps.ctx.ui.notify(
			format_inbox(messages, { full: tail.includes('--full') }),
			'info',
		);
		return;
	}
	if (sub === 'read' || sub === 'ack') {
		const ids = tail.length
			? tail
			: deps.coordination_db
					.list_inbox(require_session_id(deps), {
						include_read: true,
					})
					.map((message) => message.message_id);
		if (sub === 'read')
			deps.coordination_db.mark_messages_read(
				require_session_id(deps),
				ids,
			);
		else
			deps.coordination_db.mark_messages_acknowledged(
				require_session_id(deps),
				ids,
			);
		deps.ctx.ui.notify(
			`${sub === 'read' ? 'Read' : 'Acknowledged'} ${ids.length} message${ids.length === 1 ? '' : 's'}`,
			'info',
		);
		return;
	}
	throw new Error('Usage: /team session list|send|inbox|read|ack');
}

export async function handle_group_command(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [sub = 'list', ...tail] = rest;
	if (sub === 'list') {
		const groups = deps.coordination_db.list_groups();
		const members = new Map(
			groups.map((group) => [
				group.group_id,
				deps.coordination_db.list_group_members(group.group_id),
			]),
		);
		deps.ctx.ui.notify(format_groups(groups, members), 'info');
		return;
	}
	if (sub === 'create') {
		const name = tail.join(' ').trim();
		if (!name) throw new Error('Usage: /team group create <name>');
		const group = deps.coordination_db.create_group({
			name,
			cwd: deps.ctx.cwd,
			created_by_session_id: require_session_id(deps),
		});
		deps.ctx.ui.notify(
			`Created group ${group.name} (${group.group_id})`,
			'info',
		);
		return;
	}
	if (sub === 'join') {
		const [group_target, alias] = tail;
		if (!group_target)
			throw new Error('Usage: /team group join <group> [alias]');
		const group = deps.coordination_db.get_group(group_target);
		if (!group) throw new Error(`Unknown group: ${group_target}`);
		deps.coordination_db.add_group_member({
			group_id: group.group_id,
			session_id: require_session_id(deps),
			alias,
		});
		deps.ctx.ui.notify(`Joined ${group.name}`, 'info');
		return;
	}
	if (sub === 'send') {
		const [group_target, ...message_parts] = tail;
		if (!group_target || message_parts.length === 0)
			throw new Error('Usage: /team group send <group> <message>');
		const from_session_id = require_session_id(deps);
		const recipients = deps.coordination_db
			.list_group_members(group_target)
			.filter((member) => member.session_id !== from_session_id)
			.map((member) => member.session_id);
		const message = deps.coordination_db.send_to_group({
			from_session_id,
			target: group_target,
			body: message_parts.join(' '),
		});
		await deps.notify_coordination_messages(
			recipients,
			message.message_id,
		);
		deps.ctx.ui.notify(
			`Sent ${message.message_id} to ${group_target}`,
			'info',
		);
		return;
	}
	throw new Error('Usage: /team group list|create|join|send');
}
