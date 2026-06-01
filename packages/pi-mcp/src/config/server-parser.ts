import type {
	McpHttpServerConfig,
	McpServerConfig,
	McpStdioServerConfig,
	RawMcpServerEntry,
} from './types.js';

/**
 * Expand `${VAR}` patterns in a string using process.env.
 * Returns the string unchanged if no patterns are found.
 * Undefined/unset env vars expand to an empty string.
 */
function expand_env_vars(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
		return process.env[varName] ?? '';
	});
}

function is_string_record(
	value: unknown,
	label: string,
	name: string,
): value is Record<string, string> {
	if (value === undefined) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(
			`Invalid MCP server "${name}": ${label} must be an object of string values`,
		);
	}

	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			throw new Error(
				`Invalid MCP server "${name}": ${label}.${key} must be a string`,
			);
		}
	}

	return true;
}

export function parse_server(
	name: string,
	entry: RawMcpServerEntry,
	metadata_trusted = true,
): McpServerConfig {
	const type =
		typeof entry.type === 'string'
			? entry.type.trim().toLowerCase()
			: '';
	const disabled =
		typeof entry.disabled === 'boolean'
			? entry.disabled
			: typeof entry.enabled === 'boolean'
				? !entry.enabled
				: undefined;

	if (type && !['stdio', 'http', 'streamable-http'].includes(type)) {
		throw new Error(
			`Invalid MCP server "${name}": unsupported transport type "${type}"`,
		);
	}

	if (
		type === 'http' ||
		type === 'streamable-http' ||
		entry.url !== undefined
	) {
		if (typeof entry.url !== 'string' || !entry.url.trim()) {
			throw new Error(
				`Invalid MCP server "${name}": http transport requires a url`,
			);
		}
		is_string_record(entry.headers, 'headers', name);
		const raw_headers = entry.headers as
			| Record<string, string>
			| undefined;
		const headers = raw_headers
			? Object.fromEntries(
					Object.entries(raw_headers).map(([k, v]) => [k, expand_env_vars(v)]),
				)
			: undefined;
		const config: McpHttpServerConfig = {
			name,
			transport: 'http',
			url: entry.url.trim(),
			...(headers ? { headers } : {}),
			...(disabled !== undefined ? { disabled } : {}),
			...(metadata_trusted
				? {}
				: { metadata_trusted: false as const }),
		};
		return config;
	}

	if (typeof entry.command !== 'string' || !entry.command.trim()) {
		throw new Error(
			`Invalid MCP server "${name}": stdio transport requires a command`,
		);
	}
	if (
		entry.args !== undefined &&
		(!Array.isArray(entry.args) ||
			entry.args.some((value) => typeof value !== 'string'))
	) {
		throw new Error(
			`Invalid MCP server "${name}": args must be an array of strings`,
		);
	}
	is_string_record(entry.env, 'env', name);
	const args = entry.args as string[] | undefined;
	const env = entry.env as Record<string, string> | undefined;

	const config: McpStdioServerConfig = {
		name,
		transport: 'stdio',
		command: entry.command.trim(),
		...(args ? { args } : {}),
		...(env ? { env } : {}),
		...(disabled !== undefined ? { disabled } : {}),
		...(metadata_trusted ? {} : { metadata_trusted: false as const }),
	};
	return config;
}

export function summarize_server_entry(
	server: RawMcpServerEntry,
): string {
	if (typeof server.url === 'string' && server.url.trim()) {
		return `http ${server.url.trim()}`;
	}
	if (typeof server.command === 'string' && server.command.trim()) {
		const args = Array.isArray(server.args)
			? server.args.filter((arg) => typeof arg === 'string')
			: [];
		return ['stdio', server.command.trim(), ...args].join(' ');
	}
	return 'invalid server entry';
}
