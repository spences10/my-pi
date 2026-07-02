import {
	body_chunk_metadata,
	format_body_chunks,
} from '../chunking.js';
import { format_messages } from '../formatting.js';
import type { RpcTeammate } from '../rpc-runner.js';
import { deliver_message_to_runner } from '../runner-orchestration.js';
import type { TeamStore } from '../store.js';
import type { TeamToolParams } from '../team-tool-params.js';
import { require_arg } from './task-actions.js';

interface MessageActionContext {
	store: TeamStore;
	runners: Map<string, RpcTeammate>;
	own_member: string;
	require_team_id: () => string;
}

function has_chunk_request(params: TeamToolParams): boolean {
	return (
		params.chunk_index !== undefined ||
		params.message_id !== undefined
	);
}

function format_message_chunk(
	messages: { id: string; body: string }[],
	params: TeamToolParams,
): string | undefined {
	if (!has_chunk_request(params)) return undefined;
	const message_id = params.message_id ?? params.message_ids?.[0];
	const message = message_id
		? messages.find((item) => item.id === message_id)
		: messages[0];
	if (!message) return 'No matching message for chunk retrieval.';
	return [
		`Message ${message.id} ${JSON.stringify(body_chunk_metadata(message.body))}`,
		format_body_chunks(`message ${message.id}`, message.body, {
			chunk_index: params.chunk_index,
			before: params.before,
			after: params.after,
		}),
		'Use message_id with chunk_index/before/after for nearby chunks, or mode=full for full bodies.',
	].join('\n');
}

export async function execute_message_action(
	params: TeamToolParams,
	context: MessageActionContext,
) {
	const { store, runners, own_member, require_team_id } = context;
	switch (params.action) {
		case 'message_send': {
			const active = require_team_id();
			const message = await store.send_message(active, {
				from: params.from ?? own_member,
				to: require_arg(params.to, 'to'),
				body: require_arg(params.message, 'message'),
				urgent: params.urgent,
				reply_to: params.reply_to,
				ttl_ms: params.ttl_ms,
				requires_ack: params.requires_ack,
			});
			const runner = runners.get(message.to);
			if (runner?.is_running) {
				await deliver_message_to_runner(
					store,
					active,
					runner,
					message,
				);
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: `Sent message ${message.id} to ${message.to}`,
					},
				],
				details: { message },
			};
		}
		case 'message_list': {
			const messages = store.list_messages(
				require_team_id(),
				require_arg(params.member ?? params.to, 'member'),
			);
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							format_messages(messages, {
								full: params.mode === 'full',
							}),
					},
				],
				details: {
					message_ids: messages.map((message) => message.id),
				},
			};
		}
		case 'message_wait': {
			const message = await store.wait_for_message(
				require_team_id(),
				require_arg(params.member ?? params.to, 'member'),
				{
					reply_to: params.reply_to,
					from: params.from,
					timeout_ms: params.timeout_ms,
					include_read: params.include_read,
				},
			);
			const chunk_text = message
				? format_message_chunk([message], params)
				: undefined;
			return {
				content: [
					{
						type: 'text' as const,
						text: message
							? (chunk_text ??
								format_messages([message], {
									full: params.mode === 'full',
								}))
							: 'No matching message before timeout.',
					},
				],
				details: {
					message: message
						? { id: message.id, reply_to: message.reply_to }
						: undefined,
				},
			};
		}
		case 'message_read':
		case 'message_ack': {
			const active = require_team_id();
			const member = require_arg(
				params.member ?? params.to,
				'member',
			);
			const messages =
				params.action === 'message_read'
					? await store.mark_messages_read(
							active,
							member,
							params.message_ids,
						)
					: await store.acknowledge_messages(
							active,
							member,
							params.message_ids,
						);
			const chunk_text = format_message_chunk(messages, params);
			return {
				content: [
					{
						type: 'text' as const,
						text:
							chunk_text ??
							format_messages(messages, {
								full: params.mode === 'full',
							}),
					},
				],
				details: {
					message_ids: messages.map((message) => message.id),
				},
			};
		}
	}
	throw new Error(`Unsupported message action: ${params.action}`);
}
