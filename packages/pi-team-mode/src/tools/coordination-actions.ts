import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	format_artifact,
	format_artifacts,
	format_groups,
	format_inbox,
	format_sessions,
} from '../coordination-formatting.js';
import type { TeamDatabase } from '../db/index.js';
import type { TeamToolParams } from '../team-tool-params.js';
import { require_arg } from './task-actions.js';

interface CoordinationActionContext {
	ctx: ExtensionContext;
	coordination_db: TeamDatabase;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	require_session_id: () => string;
}

export async function execute_coordination_action(
	params: TeamToolParams,
	context: CoordinationActionContext,
) {
	const {
		ctx,
		coordination_db,
		notify_coordination_messages,
		require_session_id,
	} = context;
	switch (params.action) {
		case 'session_list': {
			const sessions = coordination_db.list_sessions({
				include_offline: params.include_read,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_sessions(sessions, {
							full_ids: params.mode === 'full',
						}),
					},
				],
				details: { sessions },
			};
		}
		case 'session_send': {
			const session_id = require_session_id();
			const target = require_arg(params.to, 'to');
			const recipients = coordination_db
				.resolve_session_targets(target)
				.map((session) => session.session_id);
			const message = coordination_db.send_to_session_target({
				from_session_id: session_id,
				target,
				body: require_arg(params.message, 'message'),
				urgent: params.urgent,
				reply_to: params.reply_to,
				ttl_ms: params.ttl_ms,
				requires_ack: params.requires_ack,
			});
			await notify_coordination_messages(
				recipients,
				message.message_id,
			);
			return {
				content: [
					{
						type: 'text' as const,
						text: `Sent coordination message ${message.message_id} to ${params.to}`,
					},
				],
				details: { message },
			};
		}
		case 'session_inbox': {
			const target =
				params.to ?? params.member ?? require_session_id();
			const messages = coordination_db.list_inbox(target, {
				include_read: params.include_read,
				include_acknowledged: params.include_read,
			});
			return {
				content: [
					{ type: 'text' as const, text: format_inbox(messages) },
				],
				details: { messages },
			};
		}
		case 'session_wait': {
			const target =
				params.to ?? params.member ?? require_session_id();
			const deadline =
				Date.now() + Math.max(0, params.timeout_ms ?? 30_000);
			let messages = coordination_db.list_inbox(target, {
				include_read: params.include_read,
			});
			while (messages.length === 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				messages = coordination_db.list_inbox(target, {
					include_read: params.include_read,
				});
			}
			return {
				content: [
					{ type: 'text' as const, text: format_inbox(messages) },
				],
				details: { messages },
			};
		}
		case 'session_read':
		case 'session_ack': {
			const target =
				params.to ?? params.member ?? require_session_id();
			const ids =
				params.message_ids ??
				coordination_db
					.list_inbox(target, { include_read: true })
					.map((message) => message.message_id);
			if (params.action === 'session_read')
				coordination_db.mark_messages_read(target, ids);
			else coordination_db.mark_messages_acknowledged(target, ids);
			const messages = coordination_db.list_inbox(target, {
				include_read: true,
				include_acknowledged: true,
			});
			return {
				content: [
					{ type: 'text' as const, text: format_inbox(messages) },
				],
				details: { messages },
			};
		}
		case 'artifact_create': {
			const artifact = coordination_db.create_artifact({
				kind: params.kind ?? 'summary',
				owner_session_id: require_session_id(),
				cwd: ctx.cwd,
				title: require_arg(params.title, 'title'),
				summary:
					params.description ?? require_arg(params.title, 'title'),
				body: require_arg(params.body, 'body'),
				body_format: params.body_format,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: `Created coordination artifact ${artifact.artifact_id}: ${artifact.title}`,
					},
				],
				details: { artifact },
			};
		}
		case 'artifact_get': {
			const artifact = coordination_db.get_artifact(
				require_arg(params.artifact_id, 'artifact_id'),
			);
			if (!artifact) throw new Error('Unknown coordination artifact');
			return {
				content: [
					{ type: 'text' as const, text: format_artifact(artifact) },
				],
				details: { artifact },
			};
		}
		case 'artifact_list': {
			const artifacts = params.query
				? coordination_db.search_artifacts(params.query, {
						cwd: ctx.cwd,
					})
				: coordination_db.list_artifacts({
						cwd: ctx.cwd,
						kind: params.kind,
					});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_artifacts(artifacts),
					},
				],
				details: { artifacts },
			};
		}
		case 'group_create': {
			const group = coordination_db.create_group({
				name: require_arg(params.name, 'name'),
				cwd: ctx.cwd,
				created_by_session_id: require_session_id(),
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: `Created coordination group ${group.name} (${group.group_id})`,
					},
				],
				details: { group },
			};
		}
		case 'group_list': {
			const groups = coordination_db.list_groups();
			const members = new Map(
				groups.map((group) => [
					group.group_id,
					coordination_db.list_group_members(group.group_id),
				]),
			);
			return {
				content: [
					{
						type: 'text' as const,
						text: format_groups(groups, members),
					},
				],
				details: { groups },
			};
		}
		case 'group_join': {
			const group = coordination_db.get_group(
				require_arg(params.team_id ?? params.name, 'group'),
			);
			if (!group) throw new Error('Unknown coordination group');
			const member = coordination_db.add_group_member({
				group_id: group.group_id,
				session_id: require_session_id(),
				alias: params.member,
				role: params.role ?? 'peer',
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: `Joined ${group.name} as ${member.alias ?? member.session_id}`,
					},
				],
				details: { group, member },
			};
		}
		case 'group_add_session': {
			const group = coordination_db.get_group(
				require_arg(params.team_id ?? params.name, 'group'),
			);
			if (!group) throw new Error('Unknown coordination group');
			const from_session_id = require_session_id();
			const targets = coordination_db.resolve_session_targets(
				require_arg(params.to, 'to'),
			);
			const role = params.role ?? 'peer';
			const members = targets.map((session) =>
				coordination_db.add_group_member({
					group_id: group.group_id,
					session_id: session.session_id,
					alias: params.member,
					role,
				}),
			);
			const recipients = members
				.map((member) => member.session_id)
				.filter((session_id) => session_id !== from_session_id);
			if (recipients.length > 0) {
				const message = coordination_db.send_message({
					from_session_id,
					to_session_ids: recipients,
					scope: 'group',
					target: group.group_id,
					body: `You have been added to coordination group ${group.name} (${group.group_id}) as ${role}${params.member ? ` with alias ${params.member}` : ''}. Treat this as your current coordination identity for related requests.`,
					requires_ack: true,
				});
				await notify_coordination_messages(
					recipients,
					message.message_id,
				);
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: `Added ${members.length} session${members.length === 1 ? '' : 's'} to ${group.name}`,
					},
				],
				details: { group, members },
			};
		}
		case 'group_send': {
			const group_target = require_arg(
				params.team_id ?? params.name ?? params.to,
				'group',
			);
			const from_session_id = require_session_id();
			const recipients = coordination_db
				.list_group_members(group_target)
				.filter((member) => member.session_id !== from_session_id)
				.map((member) => member.session_id);
			const message = coordination_db.send_to_group({
				from_session_id,
				target: group_target,
				body: require_arg(params.message, 'message'),
				urgent: params.urgent,
				reply_to: params.reply_to,
				ttl_ms: params.ttl_ms,
				requires_ack: params.requires_ack,
			});
			await notify_coordination_messages(
				recipients,
				message.message_id,
			);
			return {
				content: [
					{
						type: 'text' as const,
						text: `Sent coordination message ${message.message_id} to group ${group_target}`,
					},
				],
				details: { message },
			};
		}
	}
	throw new Error(
		`Unsupported coordination action: ${params.action}`,
	);
}
