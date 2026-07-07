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
import type { TeamToolParams } from '../team-tool-params.js';
import {
	append_visible_team_message,
	create_visible_teammate_session,
	wake_visible_teammate_session,
} from '../visible-sessions.js';

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
	wake_visible_teammate_session?: typeof wake_visible_teammate_session;
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

function format_receipt_confirmation(
	action: TeamToolParams['action'],
	message_ids: string[],
): string {
	const is_read =
		action === 'session_read' || action === 'message_read';
	const count = message_ids.length;
	const noun = `coordination message${count === 1 ? '' : 's'}`;
	const ids = count > 0 ? `: ${message_ids.join(', ')}` : '';
	return is_read
		? `Marked ${count} ${noun} read${ids}`
		: `Acknowledged ${count} ${noun}${ids}`;
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
		wake_visible_teammate_session:
			wake_teammate = wake_visible_teammate_session,
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
		case 'session_send':
		case 'message_send': {
			coordination_db.mark_stale_sessions_offline();
			const session_id = require_session_id();
			const target = require_arg(params.to, 'to');
			const target_sessions =
				coordination_db.resolve_session_targets(target);
			const recipients = target_sessions.map(
				(session) => session.session_id,
			);
			const body = require_arg(params.message, 'message');
			const message = coordination_db.send_to_session_target({
				from_session_id: params.from ?? session_id,
				target,
				body,
				urgent: params.urgent,
				reply_to: params.reply_to,
				ttl_ms: params.ttl_ms,
				requires_ack: params.requires_ack,
			});
			const offline_visible_targets = target_sessions.filter(
				(session) =>
					session.metadata.created_by ===
						'team_mode_visible_session' &&
					session.status === 'offline',
			);
			for (const target_session of target_sessions) {
				append_visible_team_message(
					target_session.session_file,
					ctx.sessionManager?.getSessionDir?.(),
					target_session.cwd,
					`Coordination message from ${message.from_session_id}:\n\n${body}`,
					{
						kind: 'coordination_message',
						message_id: message.message_id,
						from_session_id: message.from_session_id,
					},
				);
				if (!offline_visible_targets.includes(target_session))
					continue;
				coordination_db.mark_messages_delivered(
					target_session.session_id,
					[message.message_id],
				);
				coordination_db.mark_messages_read(
					target_session.session_id,
					[message.message_id],
				);
				void wake_teammate({
					session_file: target_session.session_file,
					cwd: target_session.cwd,
					message: body,
					from_session_id: message.from_session_id,
					message_id: message.message_id,
					member:
						target_session.agent_name ?? target_session.session_alias,
					timeout_ms: params.timeout_ms,
				});
			}
			await notify_coordination_messages(
				recipients,
				message.message_id,
			);
			const background_note = offline_visible_targets.length
				? ` Started background delivery for ${offline_visible_targets.length} offline visible teammate${offline_visible_targets.length === 1 ? '' : 's'}; opening the TUI later resumes the same session.`
				: '';
			return {
				content: [
					{
						type: 'text' as const,
						text: `Sent coordination message ${message.message_id} to ${target}.${background_note}`,
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
				include_acknowledged:
					params.mode === 'full' || has_chunk_request(params),
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
			if (messages.length > 0) {
				const message_ids = messages.map(
					(message) => message.message_id,
				);
				coordination_db.mark_messages_delivered(target, message_ids);
				coordination_db.mark_messages_read(target, message_ids);
				const surfaced_at = new Date().toISOString();
				messages = messages.map((message) => ({
					...message,
					delivered_at: message.delivered_at ?? surfaced_at,
					read_at: message.read_at ?? surfaced_at,
				}));
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
			const all_messages = coordination_db.list_inbox(target, {
				include_read: true,
				include_acknowledged: true,
			});
			const requested_ids = new Set(ids);
			const messages = params.message_ids
				? all_messages.filter((message) =>
						requested_ids.has(message.message_id),
					)
				: all_messages;
			const message_ids = messages.map(
				(message) => message.message_id,
			);
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							(params.mode === 'full'
								? format_inbox(messages, { full: true })
								: format_receipt_confirmation(
										params.action,
										message_ids,
									)),
					},
				],
				details: { message_ids },
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
		case 'member_spawn': {
			const lead_session_id = require_session_id();
			const teammate = create_visible_teammate_session(
				coordination_db,
				{
					cwd: ctx.cwd,
					session_dir: ctx.sessionManager.getSessionDir(),
					lead_session_id,
					lead_session_file: ctx.sessionManager.getSessionFile(),
					name: require_arg(params.name, 'name'),
					instructions: params.message,
					role: params.role ?? 'teammate',
					team_id: params.team_id,
				},
			);
			if (params.team_id) {
				coordination_db.add_group_member({
					group_id: params.team_id,
					session_id: teammate.session_id,
					alias: teammate.name,
					role: teammate.role === 'lead' ? 'lead' : 'teammate',
				});
			}
			if (params.message?.trim()) {
				void wake_teammate({
					session_file: teammate.session_file,
					cwd: ctx.cwd,
					message: params.message,
					from_session_id: lead_session_id,
					member: teammate.name,
					timeout_ms: params.timeout_ms,
				});
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: `Created teammate session ${teammate.name} (${teammate.session_id})${params.message?.trim() ? '; started background task execution' : ''}`,
					},
				],
				details: { teammate },
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
			const members = coordination_db
				.list_group_members(group_target)
				.filter((member) => member.session_id !== from_session_id);
			const recipients = members.map((member) => member.session_id);
			const body = require_arg(params.message, 'message');
			const message = coordination_db.send_to_group({
				from_session_id,
				target: group_target,
				body,
				urgent: params.urgent,
				reply_to: params.reply_to,
				ttl_ms: params.ttl_ms,
				requires_ack: params.requires_ack,
			});
			for (const member of members) {
				const target_session = coordination_db.get_session(
					member.session_id,
				);
				append_visible_team_message(
					target_session?.session_file,
					ctx.sessionManager?.getSessionDir?.(),
					target_session?.cwd ?? ctx.cwd,
					`Coordination group message from ${from_session_id} to ${group_target}:\n\n${body}`,
					{
						kind: 'coordination_group_message',
						message_id: message.message_id,
						from_session_id,
						group_id: group_target,
					},
				);
			}
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
