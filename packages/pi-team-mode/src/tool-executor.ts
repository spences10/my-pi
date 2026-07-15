import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { SqliteBusyError } from '@spences10/pi-sqlite-core';
import type { TeamDatabase } from './db/index.js';
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
}

export async function execute_team_tool(
	params: TeamToolParamsType,
	ctx: Pick<ExtensionContext, 'cwd'>,
	deps: TeamToolExecutorDeps,
) {
	validate_team_tool_params(params);
	const require_session_id = () => {
		const session_id = deps.get_session_id();
		if (!session_id)
			throw new Error('Current session is not registered yet.');
		return session_id;
	};

	try {
		return await execute_coordination_action(params, {
			ctx,
			coordination_db: deps.coordination_db,
			notify_coordination_messages: deps.notify_coordination_messages,
			require_session_id,
		});
	} catch (error) {
		if (error instanceof SqliteBusyError) {
			return {
				content: [
					{
						type: 'text' as const,
						text: `${error.message}\nRetry the team action shortly.`,
					},
				],
				details: { retryable: true },
			};
		}
		throw error;
	}
}
