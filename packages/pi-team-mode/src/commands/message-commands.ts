import { require_arg } from '../command-utils.js';
import { format_messages } from '../formatting.js';
import { deliver_message_to_runner } from '../runner-orchestration.js';
import { has_modal_ui, show_team_text_modal } from '../ui-status.js';
import type { TeamCommandDeps } from './types.js';
import { current_team_id } from './types.js';

export async function handle_dm(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [to, ...message_parts] = rest;
	const team_id = current_team_id(deps);
	const message = await deps.store.send_message(team_id, {
		from: 'lead',
		to: require_arg(to, 'recipient'),
		body: message_parts.join(' '),
	});
	const runner = deps.runners.get(message.to);
	if (runner?.is_running) {
		await deliver_message_to_runner(
			deps.store,
			team_id,
			runner,
			message,
		);
	}
	deps.ctx.ui.notify(`Sent ${message.id} to ${message.to}`);
}

export async function handle_inbox(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [member_arg, action_arg, ...ids] = rest;
	const member = member_arg || 'lead';
	const full = action_arg === '--full' || ids.includes('--full');
	const message_ids = ids.filter((id) => id !== '--full');
	let text: string;
	if (action_arg === 'read' || action_arg === 'ack') {
		const messages =
			action_arg === 'read'
				? await deps.store.mark_messages_read(
						current_team_id(deps),
						member,
						message_ids.length ? message_ids : undefined,
					)
				: await deps.store.acknowledge_messages(
						current_team_id(deps),
						member,
						message_ids.length ? message_ids : undefined,
					);
		text = format_messages(messages, { full });
	} else {
		text = format_messages(
			deps.store.list_messages(current_team_id(deps), member),
			{ full },
		);
	}
	if (has_modal_ui(deps.ctx)) {
		await show_team_text_modal(deps.ctx, {
			title: `${member} inbox`,
			text,
		});
	} else {
		deps.ctx.ui.notify(text);
	}
}

export async function handle_message_state(
	deps: TeamCommandDeps,
	sub: 'read' | 'ack',
	rest: string[],
): Promise<void> {
	const [member, ...ids] = rest;
	const messages =
		sub === 'read'
			? await deps.store.mark_messages_read(
					current_team_id(deps),
					require_arg(member, 'member'),
					ids.length ? ids : undefined,
				)
			: await deps.store.acknowledge_messages(
					current_team_id(deps),
					require_arg(member, 'member'),
					ids.length ? ids : undefined,
				);
	deps.ctx.ui.notify(format_messages(messages));
}
