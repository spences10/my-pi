import { createHash } from 'node:crypto';
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

export interface LoadMcpConfigOptions {
	include_project?: boolean;
	project_metadata_trusted?: boolean;
}

export interface McpProjectConfigInfo {
	path: string;
	hash: string;
	servers: Array<{
		name: string;
		summary: string;
	}>;
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
	metadata_trusted = true,
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
		...(metadata_trusted ? {} : { metadata_trusted: false as const }),
	};
	return config;
}

function read_config(path: string): RawMcpConfigFile['mcpServers'] {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, 'utf-8');
	const config = JSON.parse(raw) as RawMcpConfigFile;
	return config.mcpServers || {};
}

function project_mcp_config_path(cwd: string): string {
	return join(cwd, 'mcp.json');
}

export function get_project_mcp_config_info(
	cwd: string,
): McpProjectConfigInfo | undefined {
	const path = project_mcp_config_path(cwd);
	if (!existsSync(path)) return undefined;

	const raw = readFileSync(path, 'utf-8');
	const hash = createHash('sha256').update(raw).digest('hex');
	let servers: McpProjectConfigInfo['servers'] = [];
	try {
		const config = JSON.parse(raw) as RawMcpConfigFile;
		servers = Object.entries(config.mcpServers || {}).map(
			([name, server]) => ({
				name,
				summary: summarize_server_entry(server),
			}),
		);
	} catch {
		servers = [];
	}

	return { path, hash, servers };
}

function summarize_server_entry(server: RawMcpServerEntry): string {
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

export function load_mcp_config(
	cwd: string,
	options: LoadMcpConfigOptions = {},
): McpServerConfig[] {
	const global_servers = read_config(
		join(homedir(), '.pi', 'agent', 'mcp.json'),
	);
	const project_servers =
		options.include_project === false
			? {}
			: read_config(project_mcp_config_path(cwd));
	const merged_names = new Set([
		...Object.keys(global_servers),
		...Object.keys(project_servers),
	]);

	return Array.from(merged_names).map((name) => {
		const project_server = project_servers[name];
		if (project_server) {
			return parse_server(
				name,
				project_server,
				options.project_metadata_trusted !== false,
			);
		}
		return parse_server(name, global_servers[name]);
	});
}
