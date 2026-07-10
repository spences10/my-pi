import { TEAM_CHILD_ENV_ALLOWLIST_ENV } from './config.js';

export interface CreateTeamChildEnvOptions {
	source_env?: NodeJS.ProcessEnv;
	explicit_env?: Record<string, string | undefined>;
	extra_allowed_keys?: readonly string[];
}

const BASE_CHILD_ENV_KEYS = new Set([
	'CI',
	'COLORTERM',
	'FORCE_COLOR',
	'HOME',
	'LANG',
	'LOGNAME',
	'NO_COLOR',
	'PATH',
	'PI_CODING_AGENT_DIR',
	'SHELL',
	'TEMP',
	'TERM',
	'TMP',
	'TMPDIR',
	'USER',
]);

const SHARED_CHILD_ENV_ALLOWLIST = 'MY_PI_CHILD_ENV_ALLOWLIST';

function parse_allowlist(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((key) => key.trim())
		.filter(Boolean);
}

/** Build the minimal environment for Team Mode child processes. */
export function create_team_child_env(
	options: CreateTeamChildEnvOptions = {},
): NodeJS.ProcessEnv {
	const source_env = options.source_env ?? process.env;
	const allowed_keys = new Set(BASE_CHILD_ENV_KEYS);

	for (const key of Object.keys(source_env)) {
		if (key.startsWith('LC_')) allowed_keys.add(key);
	}
	for (const key of options.extra_allowed_keys ?? []) {
		if (key.trim()) allowed_keys.add(key.trim());
	}
	for (const allowlist_key of [
		SHARED_CHILD_ENV_ALLOWLIST,
		TEAM_CHILD_ENV_ALLOWLIST_ENV,
	]) {
		for (const key of parse_allowlist(source_env[allowlist_key])) {
			allowed_keys.add(key);
		}
	}

	const env: NodeJS.ProcessEnv = {};
	for (const key of allowed_keys) {
		const value = source_env[key];
		if (typeof value === 'string') env[key] = value;
	}
	for (const [key, value] of Object.entries(
		options.explicit_env ?? {},
	)) {
		if (typeof value === 'string') env[key] = value;
	}
	return env;
}
