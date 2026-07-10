import { create_child_process_env } from '@spences10/pi-child-env';

export interface CreateTeamChildEnvOptions {
	source_env?: NodeJS.ProcessEnv;
	explicit_env?: Record<string, string | undefined>;
	extra_allowed_keys?: readonly string[];
}

/** Build the minimal environment for Team Mode child processes. */
export function create_team_child_env(
	options: CreateTeamChildEnvOptions = {},
): NodeJS.ProcessEnv {
	return create_child_process_env({
		profile: 'team-mode',
		source_env: options.source_env,
		explicit_env: options.explicit_env,
		extra_allowed_keys: options.extra_allowed_keys,
	});
}
