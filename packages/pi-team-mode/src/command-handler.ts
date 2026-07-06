import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	handle_group_command,
	handle_session_command,
	handle_sessions,
} from './commands/coordination-commands.js';
import { show_team_help } from './commands/help.js';
import type { TeamCommandDeps } from './commands/types.js';
import type { TeamDatabase } from './db/index.js';
import type { HeadlessSessionRunner } from './headless-runner.js';

export {
	append_team_system_prompt,
	should_inject_team_prompt,
} from './command-utils.js';

export async function handle_team_command(
	args: string,
	ctx: ExtensionCommandContext,
	coordination_db: TeamDatabase,
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void> = async () => undefined,
	get_session_id: () => string | undefined = () => undefined,
	headless_runner?: HeadlessSessionRunner,
	headless_defaults?: TeamCommandDeps['headless_defaults'],
): Promise<void> {
	const deps: TeamCommandDeps = {
		args,
		ctx,
		coordination_db,
		notify_coordination_messages,
		get_session_id,
		handle_team_command: (next_args) =>
			handle_team_command(
				next_args,
				ctx,
				coordination_db,
				notify_coordination_messages,
				get_session_id,
				headless_runner,
				headless_defaults,
			),
		headless_runner,
		headless_defaults,
	};
	const trimmed = args.trim();
	if (!trimmed) {
		show_team_help(deps);
		return;
	}

	const [sub = 'sessions', ...rest] = trimmed.split(/\s+/);

	try {
		switch (sub) {
			case 'sessions':
				await handle_sessions(deps);
				break;
			case 'session':
				await handle_session_command(deps, rest);
				break;
			case 'group':
				await handle_group_command(deps, rest);
				break;
			default:
				show_team_help(deps);
		}
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			'warning',
		);
	}
}
