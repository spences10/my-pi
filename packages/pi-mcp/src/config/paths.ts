import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// mcp.json wins over .mcp.json (Claude Code convention) when both exist
const PROJECT_MCP_CONFIG_FILENAMES = ['mcp.json', '.mcp.json'];

export function project_mcp_config_path(cwd: string): string {
	for (const filename of PROJECT_MCP_CONFIG_FILENAMES) {
		const path = join(cwd, filename);
		if (existsSync(path)) return path;
	}
	return join(cwd, PROJECT_MCP_CONFIG_FILENAMES[0]);
}

export function ignored_project_mcp_config_path(
	cwd: string,
): string | undefined {
	const paths = PROJECT_MCP_CONFIG_FILENAMES.map((filename) =>
		join(cwd, filename),
	);
	return paths.every((path) => existsSync(path))
		? paths[1]
		: undefined;
}

export function project_mcp_policy_path(cwd: string): string {
	return join(cwd, '.pi', 'mcp-policy.json');
}

export function global_mcp_config_path(): string {
	return join(getAgentDir(), 'mcp.json');
}

export function global_mcp_policy_path(): string {
	return join(getAgentDir(), 'mcp-policy.json');
}

export function mcp_backups_dir(): string {
	return join(getAgentDir(), 'mcp-backups');
}

export function mcp_profiles_dir(): string {
	return join(getAgentDir(), 'mcp-profiles');
}

export function timestamp_for_filename(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

export function safe_profile_name(name: string): string {
	const normalized = name.trim();
	if (!/^[\w-]+$/.test(normalized)) {
		throw new Error(
			'Profile name must use only letters, numbers, underscores, and hyphens',
		);
	}
	return normalized;
}
