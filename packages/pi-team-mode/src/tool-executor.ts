import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TeamDatabase } from './db/index.js';
import type { HeadlessSessionRunner } from './headless-runner.js';
import {
	validate_team_tool_params,
	type TeamToolParams as TeamToolParamsType,
} from './team-tool-params.js';
import { execute_coordination_action } from './tools/coordination-actions.js';

export interface TeamToolExecutorDeps {
	[key: string]: unknown;
	coordination_db: TeamDatabase;
	set_active_team_id?: (team_id: string | undefined) => void;
	reset_activity?: (team_id: string | undefined) => void;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	get_session_id: () => string | undefined;
	headless_runner?: HeadlessSessionRunner;
	headless_defaults?: {
		team_root: string;
		coordination_db_path: string;
		extension_path: string;
	};
}

export async function execute_team_tool(
	params: TeamToolParamsType,
	ctx: ExtensionContext,
	deps: TeamToolExecutorDeps,
) {
	validate_team_tool_params(params);
	const require_session_id = () => {
		const session_id = deps.get_session_id();
		if (!session_id)
			throw new Error('Current session is not registered yet.');
		return session_id;
	};

	return execute_coordination_action(params, {
		ctx,
		coordination_db: deps.coordination_db,
		notify_coordination_messages: deps.notify_coordination_messages,
		require_session_id,
		headless_runner: deps.headless_runner,
		headless_defaults: deps.headless_defaults,
	});
}
