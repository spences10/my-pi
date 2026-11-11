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

const ENV_ALLOWLIST_KEYS = [
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

	for (const allowlist_key of ENV_ALLOWLIST_KEYS) {
		for (const entry of (source_env[allowlist_key] ?? '').split(
			',',
		)) {
			const key = entry.trim();

			if (key) allowed_keys.add(key);
		}
	}

	for (const key of allowed_keys) {
		const value = source_env[key];

		if (typeof value === 'string') env[key] = value;
	}

	for (const [key, value] of Object.entries(explicit_env)) {
		if (typeof value === 'string') env[key] = value;
	}

	return env;
}
