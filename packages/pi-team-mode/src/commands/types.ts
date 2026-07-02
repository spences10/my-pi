import type {
	ExtensionCommandContext,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { TeamDatabase } from '../db/index.js';
import type { RpcTeammate } from '../rpc-runner.js';
import type { TeamStore } from '../store.js';

export interface TeamCommandDeps {
	args: string;
	ctx: ExtensionCommandContext;
	store: TeamStore;
	runners: Map<string, RpcTeammate>;
	get_active_team_id: () => string | undefined;
	set_active_team_id: (team_id: string | undefined) => void;
	own_role: string;
	coordination_db: TeamDatabase;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	get_session_id: () => string | undefined;
	handle_team_command: (args: string) => Promise<void>;
}

export interface ParsedTeamCommand {
	sub: string;
	rest: string[];
	rest_text: string;
}

export function current_team_id(deps: TeamCommandDeps): string {
	const team_id = deps.get_active_team_id();
	if (!team_id)
		throw new Error(
			'No active team. Use /team create [name] or /team resume.',
		);
	return team_id;
}

export function current_model(ctx: ExtensionCommandContext) {
	return (ctx as ExtensionContext).model;
}
