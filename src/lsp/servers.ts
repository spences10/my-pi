import { existsSync } from 'node:fs';
import {
	dirname,
	extname,
	isAbsolute,
	join,
	resolve,
} from 'node:path';

export interface LspServerConfig {
	language: string;
	command: string;
	args: string[];
}

const EXTENSION_LANGUAGES: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.mts': 'typescript',
	'.cts': 'typescript',
	'.js': 'typescript',
	'.jsx': 'typescript',
	'.mjs': 'typescript',
	'.cjs': 'typescript',
	'.py': 'python',
	'.rs': 'rust',
	'.go': 'go',
	'.rb': 'ruby',
	'.java': 'java',
	'.lua': 'lua',
	'.svelte': 'svelte',
};

const LANGUAGE_SERVERS: Record<string, LspServerConfig> = {
	typescript: {
		language: 'typescript',
		command: 'typescript-language-server',
		args: ['--stdio'],
	},
	python: {
		language: 'python',
		command: 'pylsp',
		args: [],
	},
	rust: {
		language: 'rust',
		command: 'rust-analyzer',
		args: [],
	},
	go: {
		language: 'go',
		command: 'gopls',
		args: ['serve'],
	},
	ruby: {
		language: 'ruby',
		command: 'solargraph',
		args: ['stdio'],
	},
	java: {
		language: 'java',
		command: 'jdtls',
		args: [],
	},
	lua: {
		language: 'lua',
		command: 'lua-language-server',
		args: [],
	},
	svelte: {
		language: 'svelte',
		command: 'svelteserver',
		args: ['--stdio'],
	},
};

export function detect_language(
	file_path: string,
): string | undefined {
	return EXTENSION_LANGUAGES[extname(file_path).toLowerCase()];
}

export function list_supported_languages(): string[] {
	return Object.keys(LANGUAGE_SERVERS).sort();
}

export function resolve_server_command(
	command: string,
	cwd: string = process.cwd(),
): string {
	if (!command) return command;
	if (
		isAbsolute(command) ||
		command.includes('/') ||
		command.includes('\\')
	) {
		return command;
	}

	for (const dir of ancestor_directories(cwd)) {
		const local_bin = resolve_local_binary(dir, command);
		if (local_bin) return local_bin;
	}

	return command;
}

export function get_server_config(
	language: string,
	cwd: string = process.cwd(),
): LspServerConfig | undefined {
	const base = LANGUAGE_SERVERS[language];
	if (!base) return undefined;
	return {
		...base,
		command: resolve_server_command(base.command, cwd),
	};
}

export function language_id_for_file(
	file_path: string,
): string | undefined {
	return detect_language(file_path);
}

function ancestor_directories(start: string): string[] {
	const dirs: string[] = [];
	let current = resolve(start);
	while (true) {
		dirs.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs;
}

function resolve_local_binary(
	directory: string,
	command: string,
): string | undefined {
	const candidates = [
		join(directory, 'node_modules', '.bin', command),
		join(directory, 'node_modules', '.bin', `${command}.cmd`),
	];
	return candidates.find((candidate) => existsSync(candidate));
}
