import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	body_chunk_metadata,
	format_body_chunks,
} from '../chunking.js';
import {
	format_artifact,
	format_artifacts,
	format_groups,
	format_inbox,
	format_sessions,
} from '../coordination-formatting.js';
import type { TeamDatabase } from '../db/index.js';
import type { HeadlessSessionRunner } from '../headless-runner.js';
import type { TeamToolParams } from '../team-tool-params.js';

function require_arg(
	value: string | undefined,
	name: string,
): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

interface CoordinationActionContext {
	ctx: ExtensionContext;
	coordination_db: TeamDatabase;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	require_session_id: () => string;
	headless_runner?: HeadlessSessionRunner;
	headless_defaults?: {
		team_root: string;
		coordination_db_path: string;
		extension_path: string;
	};
}

function has_chunk_request(params: TeamToolParams): boolean {
	return (
		params.chunk_index !== undefined ||
		params.message_id !== undefined
	);
}

function format_message_chunk(
	messages: { message_id: string; body: string }[],
	params: TeamToolParams,
): string | undefined {
	if (!has_chunk_request(params)) return undefined;
	const message_id = params.message_id ?? params.message_ids?.[0];
	const message = message_id
		? messages.find((item) => item.message_id === message_id)
		: messages[0];
	if (!message) return 'No matching message for chunk retrieval.';
	return [
		`Message ${message.message_id} ${JSON.stringify(body_chunk_metadata(message.body))}`,
		format_body_chunks(
			`message ${message.message_id}`,
			message.body,
			{
				chunk_index: params.chunk_index,
				before: params.before,
				after: params.after,
			},
		),
		'Use message_id with chunk_index/before/after for nearby chunks, or mode=full for full bodies.',
	].join('\n');
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
			coordination_db.mark_stale_sessions_offline();
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
		case 'session_open': {
			if (!context.headless_runner || !context.headless_defaults)
				throw new Error('Headless session opening is unavailable.');
			const from_session_id = require_session_id();
			const alias = require_arg(params.member, 'member');
			const group_target = params.team_id ?? params.name;
			const group = group_target
				? coordination_db.get_group(group_target)
				: undefined;
			if (group_target && !group)
				throw new Error('Unknown coordination group');
			const opened = await context.headless_runner.open_or_resume({
				alias,
				cwd: ctx.cwd,
				parent_session_id: from_session_id,
				group_id: group?.group_id,
				message: params.message,
				intent: params.description ?? params.message,
				model: params.model,
				thinking: params.thinking,
				timeout_ms: params.timeout_ms,
				...context.headless_defaults,
			});
			const notified: string[] = [];
			if (group) {
				coordination_db.add_group_member({
					group_id: group.group_id,
					session_id: opened.session.session_id,
					alias,
					role: params.role ?? 'teammate',
				});
				const group_message = coordination_db.send_message({
					from_session_id,
					to_session_ids: [opened.session.session_id],
					scope: 'group',
					target: group.group_id,
					body: `You have been added to coordination group ${group.name} (${group.group_id}) with alias ${alias}. Treat this as your current coordination identity for related requests.`,
					requires_ack: true,
				});
				await notify_coordination_messages(
					[opened.session.session_id],
					group_message.message_id,
				);
				notified.push(group_message.message_id);
			}
			if (params.message) {
				const handoff = coordination_db.send_to_session_target({
					from_session_id,
					target: opened.session.session_id,
					body: params.message,
					requires_ack: params.requires_ack ?? true,
					urgent: params.urgent,
				});
				await notify_coordination_messages(
					[opened.session.session_id],
					handoff.message_id,
				);
				notified.push(handoff.message_id);
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: `${opened.resumed ? 'Resumed' : 'Opened'} headless session ${opened.session.session_id} (${alias})`,
					},
				],
				details: { opened, message_ids: notified },
			};
		}
		case 'session_send':
		case 'message_send': {
			coordination_db.mark_stale_sessions_offline();
			const session_id = require_session_id();
			const target = require_arg(params.to, 'to');
			const recipients = coordination_db
				.resolve_session_targets(target)
				.map((session) => session.session_id);
			const message = coordination_db.send_to_session_target({
				from_session_id: params.from ?? session_id,
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
						text: `Sent coordination message ${message.message_id} to ${target}`,
					},
				],
				details: { message },
			};
		}
		case 'session_inbox':
		case 'message_list': {
			const target =
				params.to ?? params.member ?? require_session_id();
			const messages = coordination_db.list_inbox(target, {
				include_read: params.include_read,
				include_acknowledged: params.include_read,
			});
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							format_inbox(messages, {
								full: params.mode === 'full',
							}),
					},
				],
				details: {
					messages: messages.map((message) => ({
						message_id: message.message_id,
						from_session_id: message.from_session_id,
						to_session_id: message.to_session_id,
						read_at: message.read_at,
						acknowledged_at: message.acknowledged_at,
					})),
				},
			};
		}
		case 'session_wait':
		case 'message_wait': {
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
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							format_inbox(messages, {
								full: params.mode === 'full',
							}),
					},
				],
				details: {
					message_ids: messages.map((message) => message.message_id),
				},
			};
		}
		case 'session_read':
		case 'session_ack':
		case 'message_read':
		case 'message_ack': {
			const target =
				params.to ?? params.member ?? require_session_id();
			const ids =
				params.message_ids ??
				coordination_db
					.list_inbox(target, { include_read: true })
					.map((message) => message.message_id);
			if (
				params.action === 'session_read' ||
				params.action === 'message_read'
			)
				coordination_db.mark_messages_read(target, ids);
			else coordination_db.mark_messages_acknowledged(target, ids);
			const messages = coordination_db.list_inbox(target, {
				include_read: true,
				include_acknowledged: true,
			});
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							format_inbox(messages, {
								full: params.mode === 'full',
							}),
					},
				],
				details: {
					message_ids: messages.map((message) => message.message_id),
				},
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
					{
						type: 'text' as const,
						text: format_artifact(artifact, {
							full: params.mode === 'full',
							chunk_index: params.chunk_index,
							before: params.before,
							after: params.after,
						}),
					},
				],
				details: {
					artifact_id: artifact.artifact_id,
					...body_chunk_metadata(artifact.body),
				},
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
				details: {
					artifacts: artifacts.map((artifact) => ({
						artifact_id: artifact.artifact_id,
						kind: artifact.kind,
						title: artifact.title,
						...body_chunk_metadata(artifact.body),
					})),
				},
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
			coordination_db.mark_stale_sessions_offline();
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
}
