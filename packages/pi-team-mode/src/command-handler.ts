import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	handle_group_command,
	handle_session_command,
	handle_sessions,
} from './commands/coordination-commands.js';
import { show_team_help } from './commands/help.js';
import {
	handle_dm,
	handle_inbox,
	handle_message_state,
} from './commands/message-commands.js';
import {
	handle_fake,
	handle_send_prompt,
	handle_shutdown,
	handle_spawn,
	handle_steer,
	handle_wait,
} from './commands/runner-commands.js';
import { handle_task_command } from './commands/task-commands.js';
import {
	handle_create_team,
	handle_dashboard,
	handle_delete_team,
	handle_detach_team,
	handle_member,
	handle_members,
	handle_prune_teams,
	handle_results,
	handle_resume,
	handle_status,
	handle_switch_team,
	handle_team_id,
	handle_team_ui,
	handle_teams,
	run_empty_team_command,
} from './commands/team-commands.js';
import type { TeamCommandDeps } from './commands/types.js';
import type { TeamDatabase } from './db.js';
import type { RpcTeammate } from './rpc-runner.js';
import type { TeamStore } from './store.js';
import { has_modal_ui } from './ui-status.js';

export {
	append_team_system_prompt,
	require_lead_for_teammate_spawn,
	should_inject_team_prompt,
	teammate_profile,
} from './command-utils.js';

export async function handle_team_command(
	args: string,
	ctx: ExtensionCommandContext,
	store: TeamStore,
	runners: Map<string, RpcTeammate>,
	get_active_team_id: () => string | undefined,
	set_active_team_id: (team_id: string | undefined) => void,
	own_role = 'lead',
	coordination_db?: TeamDatabase,
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void> = async () => undefined,
	get_session_id: () => string | undefined = () => undefined,
): Promise<void> {
	const deps: TeamCommandDeps = {
		args,
		ctx,
		store,
		runners,
		get_active_team_id,
		set_active_team_id,
		own_role,
		coordination_db: coordination_db as TeamDatabase,
		notify_coordination_messages,
		get_session_id,
		handle_team_command: (next_args) =>
			handle_team_command(
				next_args,
				ctx,
				store,
				runners,
				get_active_team_id,
				set_active_team_id,
				own_role,
				coordination_db,
				notify_coordination_messages,
				get_session_id,
			),
	};
	const trimmed = args.trim();
	if (!trimmed && has_modal_ui(ctx)) {
		await run_empty_team_command(deps);
		return;
	}

	const [sub = 'status', ...rest] = trimmed.split(/\s+/);
	const rest_text = rest.join(' ').trim();

	try {
		switch (sub) {
			case 'create':
				await handle_create_team(deps, rest_text);
				break;
			case 'id':
				await handle_team_id(deps);
				break;
			case 'ui':
				await handle_team_ui(deps, rest, rest_text);
				break;
			case 'teams':
				await handle_teams(deps);
				break;
			case 'sessions':
				await handle_sessions(deps);
				break;
			case 'session':
				await handle_session_command(deps, rest);
				break;
			case 'group':
				await handle_group_command(deps, rest);
				break;
			case 'switch':
				await handle_switch_team(deps, rest_text);
				break;
			case 'clear':
			case 'close':
			case 'detach':
				handle_detach_team(deps);
				break;
			case 'delete':
			case 'remove':
				await handle_delete_team(deps, rest_text);
				break;
			case 'prune':
			case 'prune-stale':
				await handle_prune_teams(deps, rest);
				break;
			case 'status':
			case 'list':
				await handle_status(deps);
				break;
			case 'dashboard':
			case 'dash':
				await handle_dashboard(deps);
				break;
			case 'results':
			case 'summary':
			case 'summarize':
				await handle_results(deps);
				break;
			case 'resume':
				handle_resume(deps);
				break;
			case 'members':
				await handle_members(deps);
				break;
			case 'member':
				await handle_member(deps, rest);
				break;
			case 'task':
				await handle_task_command(deps, rest);
				break;
			case 'dm':
				await handle_dm(deps, rest);
				break;
			case 'inbox':
				await handle_inbox(deps, rest);
				break;
			case 'read':
			case 'ack':
				await handle_message_state(deps, sub, rest);
				break;
			case 'spawn':
				await handle_spawn(deps, rest);
				break;
			case 'send':
				await handle_send_prompt(deps, rest);
				break;
			case 'steer':
				await handle_steer(deps, rest);
				break;
			case 'shutdown':
				await handle_shutdown(deps, rest);
				break;
			case 'wait':
				await handle_wait(deps, rest);
				break;
			case 'fake':
				await handle_fake(deps, rest);
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
