import { make_command_context } from '../../../tools/test-sdk.js';
import { TeamDatabase } from '../src/db/index.js';
import type { TeamCommandDeps } from '../src/commands/types.js';

export async function make_command_deps(
	overrides: Partial<TeamCommandDeps> = {},
): Promise<TeamCommandDeps> {
	return {
		args: '',
		ctx: make_command_context(),
		coordination_db:
			overrides.coordination_db ??
			(await TeamDatabase.open(':memory:')),
		notify_coordination_messages: async () => {},
		get_session_id: () => 'session-1',
		handle_team_command: async () => {},
		...overrides,
	};
}
