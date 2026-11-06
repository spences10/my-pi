import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	create_command_context,
	create_mock_client,
	create_test_pi,
	dirs,
	register_test_lsp_extension,
} from '../test/support.js';
import { DEFAULT_LSP_IDLE_TIMEOUT_MS } from './server-manager.js';

afterEach(() => {
	vi.unstubAllEnvs();
});

function create_python_project() {
	const root = mkdtempSync(join(tmpdir(), 'my-pi-python-lsp-'));
	const file = join(root, 'main.py');
	const suffix = process.platform === 'win32' ? '.exe' : '';
	const project_bin = join(
		root,
		'.venv',
		process.platform === 'win32' ? 'Scripts' : 'bin',
	);
	const project_server = join(
		project_bin,
		'pyright-langserver' + suffix,
	);
	const global_bin = join(root, 'global');
	const global_server = join(
		global_bin,
		'pyright-langserver' + suffix,
	);
	dirs.push(root);
	mkdirSync(project_bin, { recursive: true });
	mkdirSync(global_bin, { recursive: true });
	writeFileSync(
		join(root, 'pyproject.toml'),
		'[project]\nname = "test"\n',
	);
	writeFileSync(file, 'value: int = 1\n');
	writeFileSync(project_server, '#!/bin/sh\n', { mode: 0o755 });
	writeFileSync(global_server, '#!/bin/sh\n', { mode: 0o755 });
	vi.stubEnv('PATH', global_bin);
	vi.stubEnv('MY_PI_LSP_PYTHON_SERVER', 'pyright');
	return { root, file, project_server, global_server };
}

function create_typescript_7_project() {
	const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
	const file = join(root, 'src', 'main.ts');
	const project_tsc = join(root, 'node_modules', '.bin', 'tsc');
	dirs.push(root);
	mkdirSync(join(root, 'src'), { recursive: true });
	mkdirSync(join(root, 'node_modules', 'typescript', 'lib'), {
		recursive: true,
	});
	mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
	writeFileSync(join(root, 'package.json'), '{}\n');
	writeFileSync(file, 'export const value = 1;\n');
	writeFileSync(
		join(root, 'node_modules', 'typescript', 'package.json'),
		JSON.stringify({ version: '7.0.2' }),
	);
	writeFileSync(project_tsc, '#!/bin/sh\n', { mode: 0o755 });
	return { root, file, project_tsc };
}

describe('lsp server manager', () => {
	it('closes documents after one-shot tool use', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const file = join(root, 'src', 'main.ts');
		dirs.push(root);
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'package.json'), '{}\n');
		writeFileSync(file, 'export const value = 1;\n');
		const ensure_document_open = vi.fn().mockResolvedValue(undefined);
		const close_document = vi.fn().mockResolvedValue(undefined);
		const client = create_mock_client({
			ensure_document_open,
			close_document,
			hover: vi.fn().mockResolvedValue({ contents: 'hover docs' }),
		});
		const { pi, tools } = create_test_pi();
		const { ctx } = create_command_context();

		await register_test_lsp_extension(pi, {
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => root,
		});

		await tools
			.get('lsp_hover')
			.execute(
				'1',
				{ file, line: 0, character: 0 },
				undefined,
				undefined,
				ctx,
			);

		expect(ensure_document_open).toHaveBeenCalledTimes(1);
		expect(close_document).toHaveBeenCalledWith(
			expect.stringContaining('/src/main.ts'),
		);
	});

	it('does not close a shared document until concurrent calls finish', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const file = join(root, 'src', 'main.ts');
		dirs.push(root);
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'package.json'), '{}\n');
		writeFileSync(file, 'export const value = 1;\n');
		let release_first!: () => void;
		const first_hover = new Promise<{ contents: string }>(
			(resolve) => {
				release_first = () => resolve({ contents: 'first' });
			},
		);
		const close_document = vi.fn().mockResolvedValue(undefined);
		const hover = vi
			.fn()
			.mockReturnValueOnce(first_hover)
			.mockResolvedValueOnce({ contents: 'second' });
		const client = create_mock_client({
			close_document,
			hover,
		});
		const { pi, tools } = create_test_pi();
		const { ctx } = create_command_context();

		await register_test_lsp_extension(pi, {
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => root,
		});

		const first = tools
			.get('lsp_hover')
			.execute(
				'1',
				{ file, line: 0, character: 0 },
				undefined,
				undefined,
				ctx,
			);
		await vi.waitFor(() => expect(hover).toHaveBeenCalledTimes(1));
		const second = await tools
			.get('lsp_hover')
			.execute(
				'2',
				{ file, line: 0, character: 0 },
				undefined,
				undefined,
				ctx,
			);

		expect(second.content[0].text).toBe('second');
		expect(close_document).not.toHaveBeenCalled();
		release_first();
		await first;
		expect(close_document).toHaveBeenCalledTimes(1);
	});

	it('stops idle servers by default and restarts them on later use', async () => {
		vi.useFakeTimers();
		try {
			const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
			const file = join(root, 'src', 'main.ts');
			dirs.push(root);
			mkdirSync(join(root, 'src'), { recursive: true });
			writeFileSync(join(root, 'package.json'), '{}\n');
			writeFileSync(file, 'export const value = 1;\n');
			const first_stop = vi.fn().mockResolvedValue(undefined);
			const first_client = create_mock_client({
				stop: first_stop,
				hover: vi.fn().mockResolvedValue({ contents: 'first' }),
			});
			const second_client = create_mock_client({
				hover: vi.fn().mockResolvedValue({ contents: 'second' }),
			});
			const create_client = vi
				.fn()
				.mockReturnValueOnce(first_client)
				.mockReturnValueOnce(second_client);
			const { pi, tools } = create_test_pi();
			const { ctx } = create_command_context();

			await register_test_lsp_extension(pi, {
				create_client,
				read_file: async () => 'export const value = 1;\n',
				cwd: () => root,
			});

			await tools
				.get('lsp_hover')
				.execute(
					'1',
					{ file, line: 0, character: 0 },
					undefined,
					undefined,
					ctx,
				);
			await vi.advanceTimersByTimeAsync(
				DEFAULT_LSP_IDLE_TIMEOUT_MS + 1,
			);
			expect(first_stop).toHaveBeenCalledTimes(1);

			await tools
				.get('lsp_hover')
				.execute(
					'2',
					{ file, line: 0, character: 0 },
					undefined,
					undefined,
					ctx,
				);
			expect(create_client).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reuses a project binary after an idle restart without approval', async () => {
		vi.useFakeTimers();
		try {
			const { root, file, project_tsc } =
				create_typescript_7_project();
			const first_stop = vi.fn().mockResolvedValue(undefined);
			const create_client = vi
				.fn()
				.mockReturnValueOnce(create_mock_client({ stop: first_stop }))
				.mockReturnValueOnce(create_mock_client());
			const { pi, tools } = create_test_pi();
			const { ctx, select } = create_command_context();
			await register_test_lsp_extension(pi, {
				create_client,
				cwd: () => root,
				idle_timeout_ms: 10,
			});

			for (const id of ['1', '2']) {
				const result = await tools
					.get('lsp_hover')
					.execute(
						id,
						{ file, line: 0, character: 0 },
						undefined,
						undefined,
						ctx,
					);
				expect(result.details.ok).toBe(true);
				if (id === '1') {
					await vi.advanceTimersByTimeAsync(11);
					expect(first_stop).toHaveBeenCalledTimes(1);
				}
			}

			expect(select).not.toHaveBeenCalled();
			expect(create_client).toHaveBeenCalledTimes(2);
			expect(create_client).toHaveBeenLastCalledWith(
				expect.objectContaining({ command: project_tsc }),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([true, false])(
		'starts a project-local TypeScript server without approval (hasUI=%s)',
		async (has_ui) => {
			const { root, file, project_tsc } =
				create_typescript_7_project();
			vi.stubEnv('MY_PI_LSP_PROJECT_BINARY', 'skip');
			const create_client = vi.fn(() => create_mock_client());
			const { pi, tools } = create_test_pi();
			const { ctx, select } = create_command_context();
			await register_test_lsp_extension(pi, {
				create_client,
				cwd: () => root,
			});

			const results = await Promise.all(
				['1', '2', '3'].map((id) =>
					tools
						.get('lsp_hover')
						.execute(
							id,
							{ file, line: 0, character: 0 },
							undefined,
							undefined,
							{ ...ctx, hasUI: has_ui },
						),
				),
			);

			expect(results.every((result) => result.details.ok)).toBe(true);
			expect(select).not.toHaveBeenCalled();
			expect(create_client).toHaveBeenCalledTimes(1);
			expect(create_client).toHaveBeenCalledWith(
				expect.objectContaining({
					command: project_tsc,
					args: ['--lsp', '--stdio'],
				}),
			);
			expect(create_client).not.toHaveBeenCalledWith(
				expect.objectContaining({
					initialization_options: expect.anything(),
				}),
			);
		},
	);

	it('disables the syntax server for the classic TypeScript backend', async () => {
		const { root, file } = create_typescript_7_project();
		writeFileSync(
			join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js'),
			'',
		);
		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		await register_test_lsp_extension(pi, {
			create_client,
			cwd: () => root,
		});

		await tools
			.get('lsp_hover')
			.execute('1', { file, line: 0, character: 0 });

		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({
				initialization_options: {
					tsserver: { useSyntaxServer: 'never' },
				},
			}),
		);
	});

	it('does not start a server for an already-cancelled tool call', async () => {
		const { root, file } = create_typescript_7_project();
		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		const { ctx } = create_command_context();
		const controller = new AbortController();
		controller.abort();
		await register_test_lsp_extension(pi, {
			create_client,
			cwd: () => root,
		});

		const result = await tools
			.get('lsp_hover')
			.execute(
				'1',
				{ file, line: 0, character: 0 },
				controller.signal,
				undefined,
				ctx,
			);

		expect(result.details.ok).toBe(false);
		expect(create_client).not.toHaveBeenCalled();
	});

	it.each([true, false])(
		'starts a Python virtual-environment server without approval (hasUI=%s)',
		async (has_ui) => {
			const { root, file, project_server } = create_python_project();
			vi.stubEnv('MY_PI_LSP_PROJECT_BINARY', 'skip');
			const create_client = vi.fn(() => create_mock_client());
			const { pi, tools, commands } = create_test_pi();
			const { ctx, select, notifications } = create_command_context();
			await register_test_lsp_extension(pi, {
				create_client,
				cwd: () => root,
			});
			for (const id of ['1', '2']) {
				const result = await tools
					.get('lsp_hover')
					.execute(
						id,
						{ file, line: 0, character: 0 },
						undefined,
						undefined,
						{ ...ctx, hasUI: has_ui },
					);
				expect(result.details.ok).toBe(true);
			}

			expect(select).not.toHaveBeenCalled();
			expect(create_client).toHaveBeenCalledTimes(1);
			expect(create_client).toHaveBeenCalledWith(
				expect.objectContaining({
					command: project_server,
					args: ['--stdio'],
				}),
			);
			expect(create_client).not.toHaveBeenCalledWith(
				expect.objectContaining({
					initialization_options: expect.anything(),
				}),
			);
			await commands.get('lsp').handler('status', ctx);
			expect(notifications.at(-1)?.message).toContain('via pyright');
			expect(notifications.at(-1)?.message).toContain(project_server);
		},
	);

	it('starts a virtual-environment server on PATH in headless mode', async () => {
		const { root, file, project_server } = create_python_project();
		vi.stubEnv('PATH', dirname(project_server));
		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		await register_test_lsp_extension(pi, {
			create_client,
			cwd: () => root,
		});
		const result = await tools
			.get('lsp_hover')
			.execute('1', { file, line: 0, character: 0 });

		expect(result.details.ok).toBe(true);
		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({ command: project_server }),
		);
	});

	it('reports the selected Python backend setup hint without changing backends on failure', async () => {
		const { root, file } = create_python_project();
		vi.stubEnv('MY_PI_LSP_PYTHON_SERVER', 'basedpyright');
		const client = create_mock_client({
			start: vi.fn().mockRejectedValue(
				Object.assign(new Error('server missing'), {
					code: 'ENOENT',
				}),
			),
		});
		const create_client = vi.fn(() => client);
		const { pi, tools } = create_test_pi();
		const { ctx } = create_command_context();
		await register_test_lsp_extension(pi, {
			create_client,
			read_file: async () => 'value: int = 1\n',
			cwd: () => root,
		});
		const result = await tools
			.get('lsp_hover')
			.execute(
				'1',
				{ file, line: 0, character: 0 },
				undefined,
				undefined,
				ctx,
			);
		expect(result.details.ok).toBe(false);
		expect(result.content[0].text).toContain(
			'basedpyright-langserver',
		);
		expect(result.content[0].text).toContain(
			'pip install basedpyright',
		);
		expect(create_client).toHaveBeenCalledTimes(1);
		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({ command: 'basedpyright-langserver' }),
		);
	});

	it('uses the target file workspace root for client startup', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const app = join(root, 'apps', 'website');
		const file = join(app, 'src', 'routes', '+page.svelte');
		dirs.push(root);
		mkdirSync(join(app, 'src', 'routes'), { recursive: true });
		mkdirSync(join(root, 'node_modules', '.bin'), {
			recursive: true,
		});
		writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n');
		writeFileSync(join(app, 'package.json'), '{}\n');
		writeFileSync(
			join(app, 'svelte.config.js'),
			'export default {};\n',
		);
		writeFileSync(
			join(root, 'node_modules', '.bin', 'svelteserver'),
			'#!/bin/sh\n',
			{
				mode: 0o755,
			},
		);

		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		const { ctx } = create_command_context();

		await register_test_lsp_extension(pi, {
			create_client,
			read_file: async () => '<script lang="ts">\n</script>\n',
			cwd: () => '/repo/not-the-target',
		});

		await tools.get('lsp_hover').execute(
			'1',
			{
				file,
				line: 0,
				character: 0,
			},
			undefined,
			undefined,
			ctx,
		);

		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({
				command: join(root, 'node_modules', '.bin', 'svelteserver'),
				root_uri: `file://${app}`,
			}),
		);
	});
});
