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

function require_arg(
	value: string | undefined,
	name: string,
): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

function unique_session_ids(session_ids: string[]): string[] {
	return session_ids.filter(
		(session_id, index, list) => list.indexOf(session_id) === index,
	);
}

function resolve_sender_filter_ids(
	coordination_db: TeamDatabase,
	from_filter: string | undefined,
): string[] | undefined {
	if (!from_filter) return undefined;
	try {
		const resolved = coordination_db
			.resolve_session_targets(from_filter)
			.map((session) => session.session_id);
		return unique_session_ids([from_filter, ...resolved]);
	} catch {
		return [from_filter];
	}
}

function resolve_message_sender_id(
	coordination_db: TeamDatabase,
	current_session_id: string,
	from: string | undefined,
): string {
	const sender = from?.trim();
	if (!sender) return current_session_id;
	let resolved;
	try {
		resolved = coordination_db.resolve_session_targets(sender);
	} catch {
		throw new Error(
			'Team message from is bound to the current session and cannot be an unregistered label.',
		);
	}
	if (
		resolved.length === 1 &&
		resolved[0]?.session_id === current_session_id
	) {
		return current_session_id;
	}
	throw new Error(
		'Team message from is bound to the current session; sender spoofing is not allowed.',
	);
}

interface CoordinationActionContext {
	ctx: Pick<ExtensionContext, 'cwd'>;
	coordination_db: TeamDatabase;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	require_session_id: () => string;
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
	} = context;
	switch (params.action) {
		case 'session_list': {
			coordination_db.mark_stale_sessions_offline();
			const full = params.mode === 'full';
			const sessions = coordination_db.list_sessions({
				include_offline: full || params.include_read,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_sessions(sessions, {
							full_ids: full,
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
			const from_session_id = resolve_message_sender_id(
				coordination_db,
				session_id,
				params.from,
			);
			const target = require_arg(params.to, 'to');
			const target_sessions =
				coordination_db.resolve_session_targets(target);
			const recipients = target_sessions.map(
				(session) => session.session_id,
			);
			const body = require_arg(params.message, 'message');
			const message = coordination_db.send_to_session_target({
				from_session_id,
				target,
				body,
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
						text: `Sent coordination message ${message.message_id} to ${target}.`,
					},
				],
				details: { message },
			};
		}
		case 'session_inbox':
		case 'message_list': {
			const target = require_session_id();
			const messages = coordination_db.list_inbox(target, {
				include_read: params.include_read || params.mode === 'full',
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
			const target = require_session_id();
			const from_filter = resolve_sender_filter_ids(
				coordination_db,
				params.from,
			);
			const deadline =
				Date.now() + Math.max(0, params.timeout_ms ?? 30_000);
			const list_matching_messages = () =>
				coordination_db
					.list_inbox(target, {
						include_read: params.include_read,
					})
					.filter(
						(message) =>
							!from_filter ||
							from_filter.includes(message.from_session_id),
					);
			let messages = list_matching_messages();
			while (messages.length === 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				messages = list_matching_messages();
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
			const target = require_session_id();
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
