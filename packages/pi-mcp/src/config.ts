import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
	McpHttpServerConfig,
	McpServerConfig,
	McpStdioServerConfig,
} from './client.js';

interface RawMcpConfigFile {
	mcpServers: Record<string, RawMcpServerEntry>;
}

type RawMcpServerEntry = {
	type?: unknown;
	command?: unknown;
	args?: unknown;
	env?: unknown;
	url?: unknown;
	headers?: unknown;
};

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

function parse_server(
	name: string,
	entry: RawMcpServerEntry,
): McpServerConfig {
	const type =
		typeof entry.type === 'string'
			? entry.type.trim().toLowerCase()
			: '';

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
		const headers = entry.headers as
			| Record<string, string>
			| undefined;
		const config: McpHttpServerConfig = {
			name,
			transport: 'http',
			url: entry.url.trim(),
			...(headers ? { headers } : {}),
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
	};
	return config;
}

function read_config(path: string): RawMcpConfigFile['mcpServers'] {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, 'utf-8');
	const config = JSON.parse(raw) as RawMcpConfigFile;
	return config.mcpServers || {};
}

export function load_mcp_config(cwd: string): McpServerConfig[] {
	const global_servers = read_config(
		join(homedir(), '.pi', 'agent', 'mcp.json'),
	);
	const project_servers = read_config(join(cwd, 'mcp.json'));
	const merged = { ...global_servers, ...project_servers };

	return Object.entries(merged).map(([name, server]) =>
		parse_server(name, server),
	);
}
