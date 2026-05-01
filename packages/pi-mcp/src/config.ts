import { getAgentDir } from '@mariozechner/pi-coding-agent';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
	McpHttpServerConfig,
	McpServerConfig,
	McpStdioServerConfig,
} from './client.js';

interface RawMcpConfigFile {
	mcpServers: Record<string, RawMcpServerEntry>;
}

interface StoredMcpConfigFile extends RawMcpConfigFile {
	[key: string]: unknown;
}

export type McpConfigScope = 'global' | 'project';

export interface McpBackupInfo {
	filename: string;
	path: string;
	created_at: string;
	global_server_count: number;
	project_server_count: number;
}

export interface McpProfileInfo {
	name: string;
	path: string;
	server_count: number;
	created_at?: string;
}

interface McpBackupFile {
	version: 1;
	created_at: string;
	cwd: string;
	global: { exists: boolean; config: StoredMcpConfigFile };
	project: { exists: boolean; config: StoredMcpConfigFile };
}

interface McpProfileFile {
	version: 1;
	created_at: string;
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
	disabled?: unknown;
	enabled?: unknown;
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
		const headers = entry.headers as
			| Record<string, string>
			| undefined;
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

function read_config_file(path: string): StoredMcpConfigFile {
	if (!existsSync(path)) return { mcpServers: {} };
	const raw = readFileSync(path, 'utf-8');
	const config = JSON.parse(raw) as Partial<StoredMcpConfigFile>;
	return {
		...config,
		mcpServers: config.mcpServers || {},
	};
}

function write_config_file(
	path: string,
	config: StoredMcpConfigFile,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp_path = join(dirname(path), `.${Date.now()}.tmp`);
	writeFileSync(
		tmp_path,
		`${JSON.stringify(config, null, 2)}\n`,
		'utf-8',
	);
	renameSync(tmp_path, path);
}

function read_config(path: string): RawMcpConfigFile['mcpServers'] {
	return read_config_file(path).mcpServers;
}

function project_mcp_config_path(cwd: string): string {
	return join(cwd, 'mcp.json');
}

function global_mcp_config_path(): string {
	return join(getAgentDir(), 'mcp.json');
}

function mcp_backups_dir(): string {
	return join(getAgentDir(), 'mcp-backups');
}

function mcp_profiles_dir(): string {
	return join(getAgentDir(), 'mcp-profiles');
}

function timestamp_for_filename(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

function safe_profile_name(name: string): string {
	const normalized = name.trim();
	if (!/^[\w-]+$/.test(normalized)) {
		throw new Error(
			'Profile name must use only letters, numbers, underscores, and hyphens',
		);
	}
	return normalized;
}

function parse_created_at_from_backup_filename(
	filename: string,
): string {
	return filename
		.replace(/^mcp-config-/, '')
		.replace(/\.json$/, '')
		.replace(
			/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
			'$1:$2:$3.$4Z',
		);
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
	const global_servers = read_config(global_mcp_config_path());
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

function create_backup_file(cwd: string): McpBackupFile {
	const global_path = global_mcp_config_path();
	const project_path = project_mcp_config_path(cwd);
	return {
		version: 1,
		created_at: new Date().toISOString(),
		cwd,
		global: {
			exists: existsSync(global_path),
			config: read_config_file(global_path),
		},
		project: {
			exists: existsSync(project_path),
			config: read_config_file(project_path),
		},
	};
}

function to_backup_info(
	path: string,
	backup: McpBackupFile,
): McpBackupInfo {
	return {
		filename: path.split('/').pop() ?? path,
		path,
		created_at: backup.created_at,
		global_server_count: Object.keys(backup.global.config.mcpServers)
			.length,
		project_server_count: Object.keys(
			backup.project.config.mcpServers,
		).length,
	};
}

export function create_mcp_config_backup(cwd: string): McpBackupInfo {
	const backup = create_backup_file(cwd);
	const backups_dir = mcp_backups_dir();
	mkdirSync(backups_dir, { recursive: true });
	const path = join(
		backups_dir,
		`mcp-config-${timestamp_for_filename(new Date(backup.created_at))}.json`,
	);
	write_config_file(path, backup as unknown as StoredMcpConfigFile);
	return to_backup_info(path, backup);
}

export function list_mcp_config_backups(): McpBackupInfo[] {
	const backups_dir = mcp_backups_dir();
	if (!existsSync(backups_dir)) return [];
	return readdirSync(backups_dir)
		.filter(
			(file) =>
				file.startsWith('mcp-config-') && file.endsWith('.json'),
		)
		.map((filename) => {
			const path = join(backups_dir, filename);
			try {
				const backup = JSON.parse(
					readFileSync(path, 'utf-8'),
				) as McpBackupFile;
				return to_backup_info(path, backup);
			} catch {
				return {
					filename,
					path,
					created_at: parse_created_at_from_backup_filename(filename),
					global_server_count: 0,
					project_server_count: 0,
				};
			}
		})
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function restore_mcp_config_backup(
	cwd: string,
	path: string,
): McpBackupInfo {
	const backup = JSON.parse(
		readFileSync(path, 'utf-8'),
	) as McpBackupFile;
	if (backup.version !== 1) {
		throw new Error('Unsupported MCP backup version');
	}

	const global_path = global_mcp_config_path();
	const project_path = project_mcp_config_path(cwd);
	if (backup.global.exists)
		write_config_file(global_path, backup.global.config);
	else rmSync(global_path, { force: true });
	if (backup.project.exists)
		write_config_file(project_path, backup.project.config);
	else rmSync(project_path, { force: true });
	return to_backup_info(path, backup);
}

function merged_mcp_servers(
	cwd: string,
): Record<string, RawMcpServerEntry> {
	return {
		...read_config(global_mcp_config_path()),
		...read_config(project_mcp_config_path(cwd)),
	};
}

export function save_mcp_profile(
	cwd: string,
	name: string,
): McpProfileInfo {
	const safe_name = safe_profile_name(name);
	const servers = merged_mcp_servers(cwd);
	const server_count = Object.keys(servers).length;
	if (server_count === 0)
		throw new Error('No MCP servers configured to save');

	const profiles_dir = mcp_profiles_dir();
	mkdirSync(profiles_dir, { recursive: true });
	const profile: McpProfileFile = {
		version: 1,
		created_at: new Date().toISOString(),
		mcpServers: servers,
	};
	const path = join(profiles_dir, `${safe_name}.json`);
	write_config_file(path, profile as unknown as StoredMcpConfigFile);
	return {
		name: safe_name,
		path,
		server_count,
		created_at: profile.created_at,
	};
}

export function list_mcp_profiles(): McpProfileInfo[] {
	const profiles_dir = mcp_profiles_dir();
	if (!existsSync(profiles_dir)) return [];
	return readdirSync(profiles_dir)
		.filter((file) => file.endsWith('.json'))
		.map((filename) => {
			const path = join(profiles_dir, filename);
			try {
				const profile = JSON.parse(
					readFileSync(path, 'utf-8'),
				) as Partial<McpProfileFile>;
				const servers = profile.mcpServers ?? {};
				return {
					name: filename.replace(/\.json$/, ''),
					path,
					server_count: Object.keys(servers).length,
					created_at: profile.created_at,
				};
			} catch {
				return {
					name: filename.replace(/\.json$/, ''),
					path,
					server_count: 0,
				};
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function load_mcp_profile(
	cwd: string,
	name: string,
	scope: McpConfigScope = 'global',
): McpProfileInfo {
	const safe_name = safe_profile_name(name);
	const path = join(mcp_profiles_dir(), `${safe_name}.json`);
	if (!existsSync(path))
		throw new Error(`MCP profile not found: ${safe_name}`);
	const profile = JSON.parse(
		readFileSync(path, 'utf-8'),
	) as Partial<McpProfileFile>;
	const servers = profile.mcpServers ?? {};
	const target_path =
		scope === 'project'
			? project_mcp_config_path(cwd)
			: global_mcp_config_path();
	write_config_file(target_path, { mcpServers: servers });
	return {
		name: safe_name,
		path,
		server_count: Object.keys(servers).length,
		created_at: profile.created_at,
	};
}
