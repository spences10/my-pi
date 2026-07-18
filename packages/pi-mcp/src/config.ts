import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
	global_mcp_config_path,
	project_mcp_config_path,
} from './config/paths.js';
import {
	get_github_repos,
	load_mcp_policy,
	policy_matches,
} from './config/policy.js';
import {
	read_config,
	read_config_file,
	write_config_file,
} from './config/read-write.js';
import {
	parse_server,
	summarize_server_entry,
} from './config/server-parser.js';
import type {
	LoadMcpConfigOptions,
	McpProjectConfigInfo,
	McpServerConfig,
	RawMcpConfigFile,
} from './config/types.js';

export {
	create_mcp_config_backup,
	list_mcp_config_backups,
	restore_mcp_config_backup,
} from './config/backups.js';
export {
	list_mcp_profiles,
	load_mcp_profile,
	save_mcp_profile,
} from './config/profiles.js';
export type {
	LoadMcpConfigOptions,
	McpBackupInfo,
	McpConfigScope,
	McpProfileInfo,
	McpProjectConfigInfo,
} from './config/types.js';

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

export function load_mcp_config(
	cwd: string,
	options: LoadMcpConfigOptions = {},
): McpServerConfig[] {
	const global_servers = read_config(global_mcp_config_path());
	const project_servers =
		options.include_project === false
			? {}
			: read_config(project_mcp_config_path(cwd));
	const merged_names = new Set([
		...Object.keys(global_servers),
		...Object.keys(project_servers),
	]);

	const policies = load_mcp_policy(
		cwd,
		options.include_project !== false,
	);
	const github_repos = get_github_repos(cwd);

	return Array.from(merged_names)
		.filter((name) =>
			(policies[name] ?? []).every((policy) =>
				policy_matches(policy, cwd, github_repos),
			),
		)
		.map((name) => {
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

function find_server_config_path(
	cwd: string,
	name: string,
): string | undefined {
	const project_path = project_mcp_config_path(cwd);
	if (read_config(project_path)[name]) return project_path;
	const global_path = global_mcp_config_path();
	if (read_config(global_path)[name]) return global_path;
	return undefined;
}

export function set_mcp_server_enabled(
	cwd: string,
	name: string,
	enabled: boolean,
): boolean {
	const path = find_server_config_path(cwd, name);
	if (!path) return false;

	const config = read_config_file(path);
	const server = config.mcpServers[name];
	if (!server) return false;

	if (typeof server.enabled === 'boolean') {
		server.enabled = enabled;
		delete server.disabled;
	} else {
		server.disabled = !enabled;
	}

	write_config_file(path, config);
	return true;
}
