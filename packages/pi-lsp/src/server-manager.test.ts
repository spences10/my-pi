import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	create_command_context,
	create_mock_client,
	create_test_pi,
	dirs,
	register_test_lsp_extension,
} from '../test/support.js';
import { DEFAULT_LSP_IDLE_TIMEOUT_MS } from './server-manager.js';

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

	it('falls back to the global TypeScript backend when a project binary is skipped', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const file = join(root, 'src', 'main.ts');
		dirs.push(root);
		mkdirSync(join(root, 'src'), { recursive: true });
		mkdirSync(join(root, 'node_modules', '.bin'), {
			recursive: true,
		});
		writeFileSync(join(root, 'package.json'), '{}\n');
		writeFileSync(file, 'export const value = 1;\n');
		mkdirSync(join(root, 'node_modules', 'typescript', 'lib'), {
			recursive: true,
		});
		writeFileSync(
			join(root, 'node_modules', 'typescript', 'package.json'),
			JSON.stringify({ version: '7.0.2' }),
		);
		writeFileSync(
			join(root, 'node_modules', '.bin', 'tsc'),
			'#!/bin/sh\n',
			{ mode: 0o755 },
		);
		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		const { ctx, selections, select } = create_command_context();
		selections.push('Use global PATH binary instead');

		await register_test_lsp_extension(pi, {
			create_client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => root,
		});

		await Promise.all(
			['1', '2', '3'].map((id) =>
				tools
					.get('lsp_hover')
					.execute(
						id,
						{ file, line: 0, character: 0 },
						undefined,
						undefined,
						ctx,
					),
			),
		);

		expect(select).toHaveBeenCalledTimes(1);
		expect(create_client).toHaveBeenCalledTimes(1);
		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({
				command: 'tsc',
				args: ['--lsp', '--stdio'],
			}),
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
		const { ctx, selections } = create_command_context();
		selections.push('Allow once for this session');

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
