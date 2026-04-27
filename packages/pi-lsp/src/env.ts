const BASE_CHILD_ENV_KEYS = new Set([
	'CI',
	'COLORTERM',
	'FORCE_COLOR',
	'HOME',
	'LANG',
	'LOGNAME',
	'NO_COLOR',
	'PATH',
	'SHELL',
	'TEMP',
	'TERM',
	'TMP',
	'TMPDIR',
	'USER',
]);

const EXTRA_ENV_ALLOWLIST_KEYS = [
	'MY_PI_CHILD_ENV_ALLOWLIST',
	'MY_PI_LSP_ENV_ALLOWLIST',
];

export function create_child_process_env(
	explicit_env: Record<string, string> = {},
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	const allowed_keys = new Set(BASE_CHILD_ENV_KEYS);

	for (const key of Object.keys(source_env)) {
		if (key.startsWith('LC_')) allowed_keys.add(key);
	}
	for (const allowlist_key of EXTRA_ENV_ALLOWLIST_KEYS) {
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

	return { ...env, ...explicit_env };
}

function parse_env_allowlist(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map((key) => key.trim())
		.filter(Boolean);
}
