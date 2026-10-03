import { spawnSync } from 'node:child_process';
import {
	accessSync,
	constants,
	existsSync,
	readFileSync,
	realpathSync,
	statSync,
} from 'node:fs';
import {
	delimiter,
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
	backend?: string;
	install_hint?: string;
	is_project_local?: boolean;
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
		backend: 'typescript-language-server',
		install_hint:
			'Install TypeScript LSP with: pnpm add -D typescript typescript-language-server',
	},
	python: {
		language: 'python',
		command: 'pylsp',
		args: [],
		install_hint:
			'Install Python LSP with: pip install python-lsp-server',
	},
	rust: {
		language: 'rust',
		command: 'rust-analyzer',
		args: [],
		install_hint:
			'Install Rust Analyzer and ensure the rust-analyzer binary is on PATH.',
	},
	go: {
		language: 'go',
		command: 'gopls',
		args: ['serve'],
		install_hint:
			'Install Go LSP with: go install golang.org/x/tools/gopls@latest',
	},
	ruby: {
		language: 'ruby',
		command: 'solargraph',
		args: ['stdio'],
		install_hint: 'Install Ruby LSP with: gem install solargraph',
	},
	java: {
		language: 'java',
		command: 'jdtls',
		args: [],
		install_hint:
			'Install Eclipse JDT Language Server and ensure the jdtls binary is on PATH.',
	},
	lua: {
		language: 'lua',
		command: 'lua-language-server',
		args: [],
		install_hint:
			'Install Lua LSP and ensure the lua-language-server binary is on PATH.',
	},
	svelte: {
		language: 'svelte',
		command: 'svelteserver',
		args: ['--stdio'],
		install_hint:
			'Install Svelte LSP with: pnpm add -D svelte-language-server (or volta install svelte-language-server)',
	},
};

const WORKSPACE_MARKERS = [
	'svelte.config.js',
	'svelte.config.ts',
	'tsconfig.json',
	'jsconfig.json',
	'package.json',
	'pyproject.toml',
	'Cargo.toml',
	'go.mod',
	'Gemfile',
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
];

const REPOSITORY_MARKERS = [
	'pnpm-workspace.yaml',
	'package-lock.json',
	'yarn.lock',
	'bun.lockb',
	'bun.lock',
	'.git',
];

export function detect_language(
	file_path: string,
): string | undefined {
	return EXTENSION_LANGUAGES[extname(file_path).toLowerCase()];
}

export function list_supported_languages(): string[] {
	return Object.keys(LANGUAGE_SERVERS).sort();
}

export interface ResolvedServerCommand {
	command: string;
	is_project_local: boolean;
}

export function resolve_server_command_info(
	command: string,
	cwd: string = process.cwd(),
): ResolvedServerCommand {
	if (
		!command ||
		isAbsolute(command) ||
		command.includes('/') ||
		command.includes('\\')
	) {
		return { command, is_project_local: false };
	}

	for (const dir of ancestor_directories(cwd)) {
		const local_bin = resolve_local_binary(dir, command);
		if (local_bin) {
			return { command: local_bin, is_project_local: true };
		}
	}

	return { command, is_project_local: false };
}

export function resolve_server_command(
	command: string,
	cwd: string = process.cwd(),
): string {
	return resolve_server_command_info(command, cwd).command;
}

export function get_server_config(
	language: string,
	cwd: string = process.cwd(),
	options: {
		global_typescript_major?: () => number | undefined;
		env?: NodeJS.ProcessEnv;
		allow_project_local?: boolean;
	} = {},
): LspServerConfig | undefined {
	const base = LANGUAGE_SERVERS[language];
	if (!base) return undefined;
	const allow_project_local = options.allow_project_local ?? true;
	if (language === 'python') {
		return resolve_python_server(
			cwd,
			options.env,
			allow_project_local,
		);
	}
	if (language === 'typescript') {
		const native = allow_project_local
			? resolve_native_typescript_server(cwd)
			: undefined;
		if (native) return native;
		if (!allow_project_local || !has_project_typescript(cwd)) {
			const global_major =
				options.global_typescript_major?.() ??
				resolve_global_typescript_major();
			if (global_major !== undefined && global_major >= 7) {
				return {
					language: 'typescript',
					command: 'tsc',
					args: ['--lsp', '--stdio'],
					backend: 'typescript-native',
					is_project_local: false,
					install_hint:
						'TypeScript 7 native LSP requires tsc --lsp support on PATH.',
				};
			}
		}
	}
	const resolved = allow_project_local
		? resolve_server_command_info(base.command, cwd)
		: { command: base.command, is_project_local: false };
	return {
		...base,
		command: resolved.command,
		is_project_local: resolved.is_project_local,
	};
}

export function language_id_for_file(
	file_path: string,
): string | undefined {
	return detect_language(file_path);
}

export function find_workspace_root(
	file_path: string,
	fallback: string = process.cwd(),
): string {
	const start = resolve(dirname(file_path));
	const project_root = find_nearest_marker_directory(
		start,
		WORKSPACE_MARKERS,
	);
	if (project_root) return project_root;

	const repo_root = find_nearest_marker_directory(
		start,
		REPOSITORY_MARKERS,
	);
	if (repo_root) return repo_root;

	return resolve(fallback);
}

function find_nearest_marker_directory(
	start: string,
	markers: string[],
): string | undefined {
	for (const dir of ancestor_directories(start)) {
		if (markers.some((marker) => existsSync(join(dir, marker)))) {
			return dir;
		}
	}
	return undefined;
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

function resolve_global_typescript_major(): number | undefined {
	const result = spawnSync('tsc', ['--version'], {
		encoding: 'utf8',
		timeout: 2_000,
		windowsHide: true,
	});
	if (result.status !== 0) return undefined;
	const match = /Version\s+(\d+)/.exec(result.stdout);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

function has_project_typescript(cwd: string): boolean {
	return ancestor_directories(cwd).some((dir) =>
		existsSync(
			join(dir, 'node_modules', 'typescript', 'package.json'),
		),
	);
}

function resolve_native_typescript_server(
	cwd: string,
): LspServerConfig | undefined {
	for (const dir of ancestor_directories(cwd)) {
		const package_dir = join(dir, 'node_modules', 'typescript');
		const package_json = join(package_dir, 'package.json');
		const command = resolve_local_binary(dir, 'tsc');
		if (!command || !existsSync(package_json)) continue;
		try {
			const manifest = JSON.parse(
				readFileSync(package_json, 'utf8'),
			) as {
				version?: string;
			};
			const major = Number.parseInt(
				manifest.version?.split('.')[0] ?? '',
				10,
			);
			if (
				major >= 7 &&
				!existsSync(join(package_dir, 'lib', 'tsserver.js'))
			) {
				return {
					language: 'typescript',
					command,
					args: ['--lsp', '--stdio'],
					backend: 'typescript-native',
					is_project_local: true,
					install_hint:
						'TypeScript 7 native LSP requires a project-local TypeScript package with tsc --lsp support.',
				};
			}
		} catch {
			continue;
		}
	}
	return undefined;
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

const PYTHON_SERVER_ENV = 'MY_PI_LSP_PYTHON_SERVER';

const PYTHON_SERVERS = {
	pylsp: {
		command: 'pylsp',
		args: [],
		install_hint:
			'Install Python LSP with: pip install python-lsp-server',
	},
	basedpyright: {
		command: 'basedpyright-langserver',
		args: ['--stdio'],
		install_hint:
			'Install Basedpyright with: pip install basedpyright',
	},
	pyright: {
		command: 'pyright-langserver',
		args: ['--stdio'],
		install_hint: 'Install Pyright with: pip install pyright',
	},
} satisfies Record<
	string,
	{ command: string; args: string[]; install_hint: string }
>;

type PythonServer = keyof typeof PYTHON_SERVERS;
const TYPE_CHECKING_SERVERS: PythonServer[] = [
	'basedpyright',
	'pyright',
];

function resolve_python_server(
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
	allow_project_local = true,
): LspServerConfig {
	const selection = env[PYTHON_SERVER_ENV]?.trim() || 'auto';
	if (selection !== 'auto') {
		if (!Object.hasOwn(PYTHON_SERVERS, selection)) {
			throw new Error(
				`${PYTHON_SERVER_ENV} must be auto, pylsp, basedpyright, or pyright (received ${JSON.stringify(selection)}).`,
			);
		}
		const backend = selection as PythonServer;
		const config =
			(allow_project_local && find_local_server(cwd, [backend])) ||
			find_path_server(cwd, env, [backend], allow_project_local);
		if (config) return config;
		if (!allow_project_local) {
			throw new Error(
				`No ${backend} server on PATH outside the project. ${PYTHON_SERVERS[backend].install_hint}`,
			);
		}
		return server_config(backend);
	}

	// Keep an existing pylsp setup, including its plugins, unchanged.
	const config =
		(allow_project_local && find_local_server(cwd, ['pylsp'])) ||
		find_path_server(cwd, env, ['pylsp'], allow_project_local) ||
		(allow_project_local &&
			find_local_server(cwd, TYPE_CHECKING_SERVERS)) ||
		find_path_server(
			cwd,
			env,
			TYPE_CHECKING_SERVERS,
			allow_project_local,
		);
	if (config) return config;
	if (!allow_project_local) {
		throw new Error(
			`No Python language server on PATH outside the project. ${PYTHON_SERVERS.pylsp.install_hint}`,
		);
	}
	return server_config('pylsp');
}

function server_config(
	backend: PythonServer,
	command = PYTHON_SERVERS[backend].command,
	is_project_local = false,
): LspServerConfig {
	return {
		language: 'python',
		...PYTHON_SERVERS[backend],
		args: [...PYTHON_SERVERS[backend].args],
		command,
		backend,
		is_project_local,
	};
}

function find_local_server(
	cwd: string,
	backends: readonly PythonServer[],
): LspServerConfig | undefined {
	for (const directory of ancestor_directories(cwd)) {
		for (const backend of backends) {
			for (const bin_directory of python_bin_directories(directory)) {
				const command = find_executable(
					bin_directory,
					PYTHON_SERVERS[backend].command,
				);
				if (command) return server_config(backend, command, true);
			}
		}
	}
	return undefined;
}

function find_path_server(
	cwd: string,
	env: NodeJS.ProcessEnv,
	backends: readonly PythonServer[],
	allow_project_local: boolean,
): LspServerConfig | undefined {
	for (const backend of backends) {
		for (const directory of (env.PATH ?? '')
			.split(delimiter)
			.filter(Boolean)) {
			const command = find_executable(
				directory,
				PYTHON_SERVERS[backend].command,
			);
			if (!command) continue;
			const is_project_local = ancestor_directories(cwd).some(
				(directory) =>
					python_bin_directories(directory).some((bin_directory) => {
						const local = find_executable(
							bin_directory,
							PYTHON_SERVERS[backend].command,
						);
						return (
							local !== undefined &&
							realpathSync(local) === realpathSync(command)
						);
					}),
			);
			if (is_project_local && !allow_project_local) continue;
			return server_config(backend, command, is_project_local);
		}
	}
	return undefined;
}

function python_bin_directories(directory: string): string[] {
	return [
		join(
			directory,
			'.venv',
			process.platform === 'win32' ? 'Scripts' : 'bin',
		),
		join(directory, 'node_modules', '.bin'),
	];
}

function find_executable(
	directory: string,
	command: string,
): string | undefined {
	// Windows shell wrappers cannot be launched by the client's shell-free spawn.
	const extensions =
		process.platform === 'win32' ? ['.exe', ''] : [''];
	for (const extension of extensions) {
		const path = resolve(directory, command + extension);
		try {
			if (!statSync(path).isFile()) continue;
			accessSync(path, constants.X_OK);
			return path;
		} catch {
			// Missing, broken, or non-executable candidates must not block discovery.
		}
	}
	return undefined;
}
