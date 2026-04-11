import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpServerConfig } from './client.js';

interface McpConfigFile {
	mcpServers: Record<
		string,
		{
			command: string;
			args?: string[];
			env?: Record<string, string>;
		}
	>;
}

function read_config(path: string): McpConfigFile['mcpServers'] {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, 'utf-8');
	const config = JSON.parse(raw) as McpConfigFile;
	return config.mcpServers || {};
}

export function load_mcp_config(cwd: string): McpServerConfig[] {
	// Global: ~/.pi/agent/mcp.json
	const global_servers = read_config(
		join(homedir(), '.pi', 'agent', 'mcp.json'),
	);

	// Project: ./mcp.json (overrides global by name)
	const project_servers = read_config(join(cwd, 'mcp.json'));

	const merged = { ...global_servers, ...project_servers };

	return Object.entries(merged).map(([name, server]) => ({
		name,
		command: server.command,
		args: server.args,
		env: server.env,
	}));
}
