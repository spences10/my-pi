import { create_child_process_env } from '@spences10/pi-child-env';
import { normalize_member_name } from './protocol.js';

interface RpcEnvOptions {
	team_root: string;
	extension_path: string;
	thinking?: string;
}

function merge_observability_tags(
	existing: string | undefined,
	member: string,
): string {
	return [existing, 'team-mode', `teammate:${member}`]
		.filter(Boolean)
		.join(',');
}

function create_teammate_observability_env(
	source_env: NodeJS.ProcessEnv,
	team_id: string,
	member: string,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		MY_PI_OBSERVABILITY_POOL:
			source_env.MY_PI_OBSERVABILITY_POOL || team_id,
		MY_PI_OBSERVABILITY_TAG: merge_observability_tags(
			source_env.MY_PI_OBSERVABILITY_TAG ||
				source_env.PI_OBSERVABILITY_TAG,
			member,
		),
		MY_PI_OBSERVABILITY_NAME:
			source_env.MY_PI_OBSERVABILITY_NAME || member,
	};

	for (const key of [
		'MY_PI_OBSERVABILITY_URL',
		'MY_PI_OBSERVABILITY_TOKEN',
		'MY_PI_OBSERVABILITY_RAW',
		'MY_PI_OBSERVABILITY_DISABLE',
	] as const) {
		if (source_env[key]) env[key] = source_env[key];
	}

	return env;
}

export function create_rpc_teammate_env(
	options: RpcEnvOptions,
	team_id: string,
	member: string,
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const normalized_member = normalize_member_name(member);
	return create_child_process_env({
		profile: 'team-mode',
		source_env,
		explicit_env: {
			MY_PI_TEAM_MODE_ROOT: options.team_root,
			MY_PI_ACTIVE_TEAM_ID: team_id,
			MY_PI_TEAM_MEMBER: normalized_member,
			MY_PI_TEAM_ROLE: 'teammate',
			MY_PI_TEAM_EXTENSION_PATH: options.extension_path,
			...(options.thinking
				? { MY_PI_TEAM_THINKING: options.thinking }
				: {}),
			...create_teammate_observability_env(
				source_env,
				team_id,
				normalized_member,
			),
		},
	});
}
