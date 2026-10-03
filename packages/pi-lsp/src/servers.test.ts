import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	detect_language,
	find_workspace_root,
	get_server_config,
	list_supported_languages,
	resolve_server_command,
	resolve_server_command_info,
} from './servers.js';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('detect_language', () => {
	it('maps known extensions to languages', () => {
		expect(detect_language('file.ts')).toBe('typescript');
		expect(detect_language('component.svelte')).toBe('svelte');
		expect(detect_language('main.py')).toBe('python');
	});

	it('returns undefined for unknown extensions', () => {
		expect(detect_language('README.md')).toBeUndefined();
	});
});

describe('list_supported_languages', () => {
	it('includes the built-in language set', () => {
		expect(list_supported_languages()).toEqual([
			'go',
			'java',
			'lua',
			'python',
			'ruby',
			'rust',
			'svelte',
			'typescript',
		]);
	});
});

describe('resolve_server_command', () => {
	it('prefers a project-local binary from an ancestor node_modules/.bin', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const nested = join(root, 'packages', 'app');
		dirs.push(root);
		mkdirSync(join(root, 'node_modules', '.bin'), {
			recursive: true,
		});
		mkdirSync(nested, { recursive: true });
		const binary = join(
			root,
			'node_modules',
			'.bin',
			'typescript-language-server',
		);
		writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });

		expect(
			resolve_server_command('typescript-language-server', nested),
		).toBe(binary);
		expect(
			resolve_server_command_info(
				'typescript-language-server',
				nested,
			),
		).toEqual({ command: binary, is_project_local: true });
	});

	it('falls back to the bare command when no local binary exists', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		expect(resolve_server_command('gopls', cwd)).toBe('gopls');
		expect(resolve_server_command_info('gopls', cwd)).toEqual({
			command: 'gopls',
			is_project_local: false,
		});
	});
});

describe('find_workspace_root', () => {
	it('prefers the nearest project markers for nested app workspaces', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const app = join(root, 'apps', 'website');
		const file = join(app, 'src', 'routes', '+page.svelte');
		dirs.push(root);
		mkdirSync(join(app, 'src', 'routes'), { recursive: true });
		writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n');
		writeFileSync(join(app, 'package.json'), '{}\n');
		writeFileSync(
			join(app, 'svelte.config.js'),
			'export default {};\n',
		);
		writeFileSync(file, '<h1>Hello</h1>\n');

		expect(find_workspace_root(file, '/fallback')).toBe(app);
	});

	it('falls back to the provided cwd when no workspace markers exist', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const file = join(root, 'src', 'main.ts');
		dirs.push(root);
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(file, 'export const value = 1;\n');

		expect(find_workspace_root(file, '/fallback')).toBe('/fallback');
	});
});

describe('get_server_config', () => {
	it('selects the project-local TypeScript 7 native LSP', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true });
		mkdirSync(join(cwd, 'node_modules', 'typescript', 'lib'), {
			recursive: true,
		});
		writeFileSync(
			join(cwd, 'node_modules', 'typescript', 'package.json'),
			JSON.stringify({ version: '7.0.2' }),
		);
		const tsc = join(cwd, 'node_modules', '.bin', 'tsc');
		writeFileSync(tsc, '#!/bin/sh\n', { mode: 0o755 });

		expect(get_server_config('typescript', cwd)).toEqual({
			language: 'typescript',
			command: tsc,
			args: ['--lsp', '--stdio'],
			backend: 'typescript-native',
			is_project_local: true,
			install_hint:
				'TypeScript 7 native LSP requires a project-local TypeScript package with tsc --lsp support.',
		});
	});

	it('retains typescript-language-server for classic TypeScript', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true });
		mkdirSync(join(cwd, 'node_modules', 'typescript', 'lib'), {
			recursive: true,
		});
		writeFileSync(
			join(cwd, 'node_modules', 'typescript', 'package.json'),
			JSON.stringify({ version: '6.0.3' }),
		);
		writeFileSync(
			join(cwd, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
			'',
		);
		const server = join(
			cwd,
			'node_modules',
			'.bin',
			'typescript-language-server',
		);
		writeFileSync(server, '#!/bin/sh\n', { mode: 0o755 });

		expect(get_server_config('typescript', cwd)).toMatchObject({
			command: server,
			args: ['--stdio'],
			backend: 'typescript-language-server',
			is_project_local: true,
		});
	});

	it('selects a global TypeScript 7 native LSP when no project TypeScript exists', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		expect(
			get_server_config('typescript', cwd, {
				global_typescript_major: () => 7,
			}),
		).toEqual({
			language: 'typescript',
			command: 'tsc',
			args: ['--lsp', '--stdio'],
			backend: 'typescript-native',
			is_project_local: false,
			install_hint:
				'TypeScript 7 native LSP requires tsc --lsp support on PATH.',
		});
	});

	it('returns a resolved config for known languages', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		const config = get_server_config('typescript', cwd, {
			global_typescript_major: () => 6,
		});
		expect(config).toMatchObject({
			language: 'typescript',
			args: ['--stdio'],
			backend: 'typescript-language-server',
		});
		expect(config?.command).toBe('typescript-language-server');
	});

	it('ignores project TypeScript when project binaries are excluded', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		mkdirSync(join(cwd, 'node_modules', 'typescript', 'lib'), {
			recursive: true,
		});
		mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true });
		writeFileSync(
			join(cwd, 'node_modules', 'typescript', 'package.json'),
			JSON.stringify({ version: '7.0.2' }),
		);
		writeFileSync(
			join(cwd, 'node_modules', '.bin', 'tsc'),
			'#!/bin/sh\n',
			{ mode: 0o755 },
		);
		expect(
			get_server_config('typescript', cwd, {
				allow_project_local: false,
				global_typescript_major: () => 6,
			}),
		).toMatchObject({
			command: 'typescript-language-server',
			backend: 'typescript-language-server',
			is_project_local: false,
		});
	});

	it('excludes project binaries for other languages after a trust refusal', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		mkdirSync(join(cwd, 'node_modules', '.bin'), { recursive: true });
		writeFileSync(
			join(cwd, 'node_modules', '.bin', 'svelteserver'),
			'#!/bin/sh\n',
			{ mode: 0o755 },
		);
		expect(
			get_server_config('svelte', cwd, {
				allow_project_local: false,
			}),
		).toMatchObject({
			command: 'svelteserver',
			is_project_local: false,
		});
	});

	it('returns undefined for unknown languages', () => {
		expect(get_server_config('elixir')).toBeUndefined();
	});
});

const venv_bin = process.platform === 'win32' ? 'Scripts' : 'bin';
const binary_suffix = process.platform === 'win32' ? '.exe' : '';

function project(): string {
	const directory = mkdtempSync(join(tmpdir(), 'my-pi-python-lsp-'));
	dirs.push(directory);
	return directory;
}

function binary(
	directory: string,
	command: string,
	mode = 0o755,
): string {
	mkdirSync(directory, { recursive: true });
	const path = join(directory, command + binary_suffix);
	writeFileSync(path, '#!/bin/sh\n', { mode });
	return path;
}

function config(cwd: string, env: NodeJS.ProcessEnv = {}) {
	return get_server_config('python', cwd, { env });
}

describe('Python server selection', () => {
	it('preserves global pylsp when both type-checking servers are installed', () => {
		const cwd = project();
		const bin = join(cwd, 'global bin');
		const pylsp = binary(bin, 'pylsp');
		binary(bin, 'basedpyright-langserver');
		binary(bin, 'pyright-langserver');
		expect(config(cwd, { PATH: bin })).toMatchObject({
			command: pylsp,
			args: [],
			backend: 'pylsp',
			is_project_local: false,
		});
	});

	it('does not replace global pylsp with a local type checker in auto mode', () => {
		const cwd = project();
		const bin = join(cwd, 'global');
		const pylsp = binary(bin, 'pylsp');
		binary(join(cwd, '.venv', venv_bin), 'basedpyright-langserver');
		expect(config(cwd, { PATH: bin })?.command).toBe(pylsp);
	});

	it('finds local pylsp in a virtual environment before global pylsp', () => {
		const cwd = project();
		const local = binary(join(cwd, '.venv', venv_bin), 'pylsp');
		const bin = join(cwd, 'global');
		binary(bin, 'pylsp');
		expect(config(cwd, { PATH: bin })).toMatchObject({
			command: local,
			backend: 'pylsp',
			is_project_local: true,
		});
	});

	it('finds Basedpyright in an ancestor virtual environment', () => {
		const cwd = project();
		const nested = join(cwd, 'src', 'nested');
		mkdirSync(nested, { recursive: true });
		const local = binary(
			join(cwd, '.venv', venv_bin),
			'basedpyright-langserver',
		);
		expect(config(nested)).toMatchObject({
			command: local,
			args: ['--stdio'],
			backend: 'basedpyright',
			is_project_local: true,
		});
	});

	it('prefers project-local Pyright over global Basedpyright when pylsp is absent', () => {
		const cwd = project();
		const local = binary(
			join(cwd, 'node_modules', '.bin'),
			'pyright-langserver',
		);
		const bin = join(cwd, 'global');
		binary(bin, 'basedpyright-langserver');
		expect(config(cwd, { PATH: bin })).toMatchObject({
			command: local,
			backend: 'pyright',
			is_project_local: true,
		});
	});

	it('prefers a nearer Pyright install over an ancestor Basedpyright install', () => {
		const cwd = project();
		const nested = join(cwd, 'packages', 'app');
		binary(
			join(cwd, 'node_modules', '.bin'),
			'basedpyright-langserver',
		);
		const local = binary(
			join(nested, 'node_modules', '.bin'),
			'pyright-langserver',
		);
		expect(config(nested)?.command).toBe(local);
	});

	it('prefers local Basedpyright over local Pyright in the same project', () => {
		const cwd = project();
		const bin = join(cwd, '.venv', venv_bin);
		const basedpyright = binary(bin, 'basedpyright-langserver');
		binary(bin, 'pyright-langserver');
		expect(config(cwd)?.command).toBe(basedpyright);
	});

	it('selects global Basedpyright before global Pyright when pylsp is absent', () => {
		const cwd = project();
		const bin = join(cwd, 'global');
		const basedpyright = binary(bin, 'basedpyright-langserver');
		binary(bin, 'pyright-langserver');
		expect(config(cwd, { PATH: bin })).toMatchObject({
			command: basedpyright,
			backend: 'basedpyright',
			is_project_local: false,
		});
	});

	it('selects global Pyright when it is the only installed Python server', () => {
		const cwd = project();
		const bin = join(cwd, 'global');
		const pyright = binary(bin, 'pyright-langserver');
		expect(config(cwd, { PATH: bin })?.command).toBe(pyright);
	});

	it.each<[string, string, string[]]>([
		['pylsp', 'pylsp', []],
		['pyright', 'pyright-langserver', ['--stdio']],
		['basedpyright', 'basedpyright-langserver', ['--stdio']],
	])('honours an explicit %s selection', (backend, command, args) => {
		const cwd = project();
		const bin = join(cwd, 'global');
		binary(bin, 'pylsp');
		binary(bin, 'basedpyright-langserver');
		binary(bin, 'pyright-langserver');
		const selected = binary(join(cwd, '.venv', venv_bin), command);
		expect(
			config(cwd, {
				PATH: bin,
				MY_PI_LSP_PYTHON_SERVER: backend,
			}),
		).toMatchObject({
			command: selected,
			args,
			backend,
			is_project_local: true,
		});
	});

	it('does not switch backends when an explicitly selected server is missing', () => {
		const cwd = project();
		const bin = join(cwd, 'global');
		binary(bin, 'pylsp');
		expect(
			config(cwd, { PATH: bin, MY_PI_LSP_PYTHON_SERVER: 'pyright' }),
		).toMatchObject({
			command: 'pyright-langserver',
			backend: 'pyright',
			is_project_local: false,
			install_hint: 'Install Pyright with: pip install pyright',
		});
	});

	it('retains the pylsp command and setup hint when no server is installed', () => {
		expect(config(project())).toMatchObject({
			command: 'pylsp',
			args: [],
			backend: 'pylsp',
			is_project_local: false,
			install_hint:
				'Install Python LSP with: pip install python-lsp-server',
		});
	});

	it('rejects unsupported selections with a useful error', () => {
		expect(() =>
			config(project(), { MY_PI_LSP_PYTHON_SERVER: 'unknown' }),
		).toThrow(
			'MY_PI_LSP_PYTHON_SERVER must be auto, pylsp, basedpyright, or pyright',
		);
	});

	it('accepts an explicit auto selection', () => {
		expect(
			config(project(), { MY_PI_LSP_PYTHON_SERVER: 'auto' })?.backend,
		).toBe('pylsp');
	});

	it('can exclude project-local servers after a trust refusal', () => {
		const cwd = project();
		binary(join(cwd, '.venv', venv_bin), 'basedpyright-langserver');
		const bin = join(cwd, 'global');
		const pyright = binary(bin, 'pyright-langserver');
		expect(
			get_server_config('python', cwd, {
				env: { PATH: bin },
				allow_project_local: false,
			}),
		).toMatchObject({
			command: pyright,
			is_project_local: false,
		});
	});

	it('does not rediscover an untrusted virtual-environment server through PATH', () => {
		const cwd = project();
		const local_bin = join(cwd, '.venv', venv_bin);
		binary(local_bin, 'pylsp');
		binary(local_bin, 'basedpyright-langserver');
		expect(() =>
			get_server_config('python', cwd, {
				env: { PATH: local_bin },
				allow_project_local: false,
			}),
		).toThrow(
			'No Python language server on PATH outside the project',
		);
	});

	it('skips an untrusted server earlier on PATH and selects a separate global install', () => {
		const cwd = project();
		const local_bin = join(cwd, '.venv', venv_bin);
		binary(local_bin, 'pyright-langserver');
		const global_bin = join(cwd, 'global');
		const global = binary(global_bin, 'pyright-langserver');
		expect(
			get_server_config('python', cwd, {
				env: {
					PATH: [local_bin, global_bin].join(delimiter),
					MY_PI_LSP_PYTHON_SERVER: 'pyright',
				},
				allow_project_local: false,
			}),
		).toMatchObject({ command: global, is_project_local: false });
	});

	it.skipIf(process.platform === 'win32')(
		'does not treat a PATH symlink to an untrusted server as global',
		() => {
			const cwd = project();
			const local = binary(
				join(cwd, '.venv', venv_bin),
				'pyright-langserver',
			);
			const bin = join(cwd, 'alias');
			mkdirSync(bin, { recursive: true });
			symlinkSync(local, join(bin, 'pyright-langserver'));
			expect(() =>
				get_server_config('python', cwd, {
					env: { PATH: bin, MY_PI_LSP_PYTHON_SERVER: 'pyright' },
					allow_project_local: false,
				}),
			).toThrow('No pyright server on PATH outside the project');
		},
	);

	it('skips directories masquerading as PATH binaries', () => {
		const cwd = project();
		const bin = join(cwd, 'global');
		mkdirSync(join(bin, 'basedpyright-langserver' + binary_suffix), {
			recursive: true,
		});
		const pyright = binary(bin, 'pyright-langserver');
		expect(config(cwd, { PATH: bin })?.command).toBe(pyright);
	});

	it.skipIf(process.platform === 'win32')(
		'skips non-executable local and PATH candidates',
		() => {
			const cwd = project();
			binary(join(cwd, '.venv', venv_bin), 'pylsp', 0o644);
			const first = join(cwd, 'first');
			binary(first, 'basedpyright-langserver', 0o644);
			const second = join(cwd, 'second');
			const basedpyright = binary(second, 'basedpyright-langserver');
			expect(
				config(cwd, { PATH: [first, second].join(delimiter) })
					?.command,
			).toBe(basedpyright);
		},
	);

	it.skipIf(process.platform === 'win32')(
		'skips broken local symlinks',
		() => {
			const cwd = project();
			const broken = join(
				cwd,
				'.venv',
				venv_bin,
				'basedpyright-langserver',
			);
			mkdirSync(dirname(broken), { recursive: true });
			symlinkSync(join(cwd, 'missing'), broken);
			const local = binary(
				join(cwd, 'node_modules', '.bin'),
				'pyright-langserver',
			);
			expect(config(cwd)?.command).toBe(local);
		},
	);
});
