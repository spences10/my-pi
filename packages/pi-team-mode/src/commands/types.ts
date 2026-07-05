import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { TeamDatabase } from '../db/index.js';
import type { HeadlessSessionRunner } from '../headless-runner.js';

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
	headless_runner?: HeadlessSessionRunner;
	headless_defaults?: {
		team_root: string;
		coordination_db_path: string;
		extension_path: string;
	};
}

export interface ParsedTeamCommand {
	sub: string;
	rest: string[];
	rest_text: string;
}
