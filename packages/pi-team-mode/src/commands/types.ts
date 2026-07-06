import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { TeamDatabase } from '../db/index.js';

export interface TeamCommandDeps {
	args: string;
	ctx: ExtensionCommandContext;
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
