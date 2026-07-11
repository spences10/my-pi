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
import type {
	CoordinationSessionRuntime,
	TeamDatabase,
} from '../db/index.js';
import { sanitize_diagnostic_stream } from '../diagnostics.js';
import {
	follow_up_runtime,
	prompt_runtime,
	steer_runtime,
} from '../runtime/client.js';
import { assert_teammate_spawn_allowed } from '../spawn-limits.js';
import type { TeamToolParams } from '../team-tool-params.js';
import {
	append_visible_team_message,
	create_visible_teammate_session,
	run_direct_teammate_command,
	should_use_persistent_team_runtime,
	wake_visible_teammate_session,
} from '../visible-sessions.js';
import { resolve_teammate_workspace } from '../workspace-policy.js';

function require_arg(
	value: string | undefined,
	name: string,
): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

function split_session_targets(value: string | undefined): string[] {
	return (value ?? '')
		.split(/[\s,]+/)
		.map((target) => target.trim())
		.filter(Boolean);
}

function unique_session_ids(session_ids: string[]): string[] {
	return session_ids.filter(
		(session_id, index, list) => list.indexOf(session_id) === index,
	);
}

function resolve_report_recipients(
	coordination_db: TeamDatabase,
	targets: string[],
): string[] {
	return unique_session_ids(
		targets.flatMap((target) =>
			coordination_db
				.resolve_session_targets(target)
				.map((session) => session.session_id),
		),
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

function format_direct_command_result(
	result: Awaited<ReturnType<typeof run_direct_teammate_command>>,
): string {
	const parts = [
		`Direct teammate command finished with exit code ${result.exit_code}${result.timed_out ? ' after timing out' : ''}.`,
		`Command: ${result.command}`,
	];
	if (result.stdout.trim())
		parts.push(`stdout:\n${result.stdout.trim()}`);
	if (result.stderr.trim())
		parts.push(`stderr:\n${result.stderr.trim()}`);
	return parts.join('\n\n');
}

type RuntimeDeliveryMethod = 'prompt' | 'steer' | 'follow_up';

type DeliverRuntimeMessage = (
	runtime: CoordinationSessionRuntime,
	message: string,
	method: RuntimeDeliveryMethod,
	timeout_ms?: number,
) => Promise<CoordinationSessionRuntime>;

async function deliver_runtime_message(
	runtime: CoordinationSessionRuntime,
	message: string,
	method: RuntimeDeliveryMethod,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	if (method === 'steer')
		return await steer_runtime(runtime, message, timeout_ms);
	if (method === 'follow_up')
		return await follow_up_runtime(runtime, message, timeout_ms);
	return await prompt_runtime(runtime, message, timeout_ms);
}

function runtime_delivery_method(
	runtime: CoordinationSessionRuntime,
	urgent: boolean | undefined,
): RuntimeDeliveryMethod {
	if (urgent) return 'steer';
	return ['running', 'waiting', 'blocked'].includes(runtime.state)
		? 'follow_up'
		: 'prompt';
}

function is_live_runtime(
	runtime: CoordinationSessionRuntime | undefined,
): boolean {
	return Boolean(
		runtime &&
		['ready', 'idle', 'running', 'waiting', 'blocked'].includes(
			runtime.state,
		),
	);
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
	deliver_runtime_message?: DeliverRuntimeMessage;
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
		deliver_runtime_message:
			deliver_to_runtime = deliver_runtime_message,
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
			const offline_visible_targets = target_sessions.filter(
				(session) =>
					session.metadata.created_by ===
						'team_mode_visible_session' &&
					session.status === 'offline',
			);
			const report_recipients = params.reply_to
				? resolve_report_recipients(coordination_db, [
						message.from_session_id,
						params.reply_to,
					])
				: [message.from_session_id];
			const runtime_deliveries: Array<{
				session_id: string;
				method: RuntimeDeliveryMethod | 'start';
				state?: string;
				accepted: boolean;
			}> = [];
			for (const target_session of target_sessions) {
				const persistent_runtime =
					coordination_db.get_session_runtime(
						target_session.session_id,
					);
				if (
					persistent_runtime &&
					is_live_runtime(persistent_runtime)
				) {
					const method = runtime_delivery_method(
						persistent_runtime,
						params.urgent,
					);
					const accepted = await deliver_to_runtime(
						persistent_runtime,
						body,
						method,
						params.timeout_ms,
					);
					coordination_db.mark_messages_delivered(
						target_session.session_id,
						[message.message_id],
					);
					runtime_deliveries.push({
						session_id: target_session.session_id,
						method,
						state: accepted.state,
						accepted: true,
					});
					continue;
				}
				if (!persistent_runtime) {
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
				}
				const wake_options = {
					session_file: target_session.session_file,
					cwd: target_session.cwd,
					message: body,
					from_session_id: message.from_session_id,
					message_id: message.message_id,
					member:
						target_session.agent_name ?? target_session.session_alias,
					role: target_session.role,
					report_to_session_ids: report_recipients,
					timeout_ms: params.timeout_ms,
				};
				if (
					persistent_runtime &&
					['created', 'starting', 'offline', 'failed'].includes(
						persistent_runtime.state,
					)
				) {
					const accepted = await wake_teammate(wake_options);
					if (!accepted?.accepted)
						throw new Error(
							'Persistent runtime did not accept the message',
						);
					coordination_db.mark_messages_delivered(
						target_session.session_id,
						[message.message_id],
					);
					runtime_deliveries.push({
						session_id: target_session.session_id,
						method: 'start',
						state: accepted.runtime?.state,
						accepted: true,
					});
					continue;
				}
				if (persistent_runtime)
					throw new Error(
						`Persistent runtime is not available (${persistent_runtime.state})`,
					);
				if (!offline_visible_targets.includes(target_session))
					continue;
				if (should_use_persistent_team_runtime()) {
					const accepted = await wake_teammate(wake_options);
					if (!accepted?.accepted)
						throw new Error(
							'Persistent runtime did not accept the message',
						);
					coordination_db.mark_messages_delivered(
						target_session.session_id,
						[message.message_id],
					);
					runtime_deliveries.push({
						session_id: target_session.session_id,
						method: 'start',
						state: accepted.runtime?.state,
						accepted: true,
					});
				} else {
					void wake_teammate(wake_options)
						.then(() => {
							coordination_db.mark_messages_delivered(
								target_session.session_id,
								[message.message_id],
							);
						})
						.catch(() => undefined);
				}
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
				details: { message, runtime_deliveries },
			};
		}
		case 'session_inbox':
		case 'message_list': {
			const target = require_session_id();
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
		case 'member_spawn': {
			const lead_session_id = require_session_id();
			assert_teammate_spawn_allowed(coordination_db, lead_session_id);
			const teammate_cwd = resolve_teammate_workspace({
				db: coordination_db,
				lead_cwd: ctx.cwd,
				mode: params.workspace_mode!,
				path: params.workspace_path,
			});
			const teammate = create_visible_teammate_session(
				coordination_db,
				{
					cwd: teammate_cwd,
					session_dir: ctx.sessionManager.getSessionDir(),
					lead_session_id,
					lead_session_file: ctx.sessionManager.getSessionFile(),
					name: require_arg(params.name, 'name'),
					instructions: params.instructions,
					role: params.role ?? 'teammate',
					team_id: params.team_id,
				},
			);
			if (params.team_id) {
				coordination_db.add_group_member({
					group_id: params.team_id,
					session_id: teammate.session_id,
					alias: teammate.name,
					role: teammate.role,
				});
			}
			const report_recipients = resolve_report_recipients(
				coordination_db,
				[
					lead_session_id,
					params.reply_to,
					...split_session_targets(params.to),
				].filter(Boolean) as string[],
			);
			let runtime_status:
				| {
						mode: 'persistent';
						accepted: boolean;
						method?: string;
						state?: string;
						error?: string;
				  }
				| undefined;
			if (params.command?.trim()) {
				const safe_command = sanitize_diagnostic_stream(
					params.command,
				).text;
				append_visible_team_message(
					teammate.session_file,
					ctx.sessionManager?.getSessionDir?.(),
					teammate_cwd,
					`Direct teammate command started by ${lead_session_id}:\n\n${safe_command}`,
					{
						kind: 'direct_teammate_command_started',
						from_session_id: lead_session_id,
						report_to_session_ids: report_recipients,
					},
				);
				void (async () => {
					const result = await run_direct_teammate_command({
						cwd: teammate_cwd,
						command: params.command!,
						timeout_ms: params.timeout_ms,
						member: teammate.name,
						role: teammate.role,
					});
					const body = format_direct_command_result(result);
					append_visible_team_message(
						teammate.session_file,
						ctx.sessionManager?.getSessionDir?.(),
						teammate_cwd,
						body,
						{
							kind: 'direct_teammate_command_result',
							from_session_id: teammate.session_id,
							report_to_session_ids: report_recipients,
						},
					);
					const message = coordination_db.send_message({
						from_session_id: teammate.session_id,
						to_session_ids: report_recipients,
						scope: 'session',
						target: report_recipients.join(','),
						body,
						metadata: {
							kind: 'direct_teammate_command_result',
							command: result.command,
							exit_code: result.exit_code,
							signal: result.signal,
							timed_out: result.timed_out,
							stdout_bytes: result.diagnostics.stdout.bytes,
							stdout_truncated: result.diagnostics.stdout.truncated,
							stderr_bytes: result.diagnostics.stderr.bytes,
							stderr_truncated: result.diagnostics.stderr.truncated,
						},
					});
					await notify_coordination_messages(
						report_recipients,
						message.message_id,
					);
				})();
			} else {
				const wake_options = {
					session_file: teammate.session_file,
					cwd: teammate_cwd,
					message: params.instructions,
					from_session_id: lead_session_id,
					member: teammate.name,
					role: teammate.role,
					report_to_session_ids: report_recipients,
					timeout_ms: params.timeout_ms,
				};
				if (should_use_persistent_team_runtime()) {
					try {
						const status = await wake_teammate(wake_options);
						runtime_status = {
							mode: 'persistent',
							accepted: status?.accepted === true,
							method: status?.method,
							state: status?.runtime?.state,
						};
					} catch (error) {
						runtime_status = {
							mode: 'persistent',
							accepted: false,
							error: (error as Error).message,
						};
					}
				} else if (params.instructions?.trim()) {
					void wake_teammate(wake_options);
				}
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: `Created teammate session ${teammate.name} (${teammate.session_id})${params.command?.trim() ? '; started direct command execution' : runtime_status?.accepted ? '; persistent runtime accepted initial prompt' : runtime_status?.error ? `; persistent runtime failed: ${runtime_status.error}` : params.instructions?.trim() ? '; started background task execution' : ''}`,
					},
				],
				details: {
					teammate,
					report_recipients,
					runtime: runtime_status,
				},
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
