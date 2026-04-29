export type ChildEnvProfile = 'mcp' | 'lsp' | 'hooks' | 'team-mode';

export interface CreateChildProcessEnvOptions {
	profile?: ChildEnvProfile;
	explicit_env?: Record<string, string | undefined>;
	source_env?: NodeJS.ProcessEnv;
	extra_allowed_keys?: readonly string[];
	extra_allowlist_env_keys?: readonly string[];
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

const SHARED_ENV_ALLOWLIST_KEY = 'MY_PI_CHILD_ENV_ALLOWLIST';

const PROFILE_ENV_ALLOWLIST_KEYS: Record<ChildEnvProfile, string> = {
	mcp: 'MY_PI_MCP_ENV_ALLOWLIST',
	lsp: 'MY_PI_LSP_ENV_ALLOWLIST',
	hooks: 'MY_PI_HOOKS_ENV_ALLOWLIST',
	'team-mode': 'MY_PI_TEAM_MODE_ENV_ALLOWLIST',
};

export function create_child_process_env(
	options: CreateChildProcessEnvOptions = {},
): NodeJS.ProcessEnv {
	const source_env = options.source_env ?? process.env;
	const env: NodeJS.ProcessEnv = {};
	const allowed_keys = new Set(BASE_CHILD_ENV_KEYS);

	for (const key of Object.keys(source_env)) {
		if (key.startsWith('LC_')) allowed_keys.add(key);
	}

	for (const key of options.extra_allowed_keys ?? []) {
		if (key.trim()) allowed_keys.add(key.trim());
	}

	const allowlist_env_keys = [
		SHARED_ENV_ALLOWLIST_KEY,
		...(options.profile
			? [PROFILE_ENV_ALLOWLIST_KEYS[options.profile]]
			: []),
		...(options.extra_allowlist_env_keys ?? []),
	];
	for (const allowlist_key of allowlist_env_keys) {
		for (const key of parse_env_allowlist(
			source_env[allowlist_key],
		)) {
			allowed_keys.add(key);
		}
	}

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

function parse_env_allowlist(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map((key) => key.trim())
		.filter(Boolean);
}
