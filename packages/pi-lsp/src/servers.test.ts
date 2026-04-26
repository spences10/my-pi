import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	detect_language,
	find_workspace_root,
	get_server_config,
	list_supported_languages,
	resolve_server_command,
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
	});

	it('falls back to the bare command when no local binary exists', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		expect(resolve_server_command('gopls', cwd)).toBe('gopls');
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
	it('returns a resolved config for known languages', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		dirs.push(cwd);
		const config = get_server_config('typescript', cwd);
		expect(config).toMatchObject({
			language: 'typescript',
			args: ['--stdio'],
		});
		expect(config?.command).toBe('typescript-language-server');
	});

	it('returns undefined for unknown languages', () => {
		expect(get_server_config('elixir')).toBeUndefined();
	});
});
