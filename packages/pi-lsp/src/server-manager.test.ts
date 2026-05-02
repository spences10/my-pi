import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	create_command_context,
	create_mock_client,
	create_test_pi,
	dirs,
} from '../test/support.js';
import { create_lsp_extension } from './index.js';

describe('lsp server manager', () => {
	it('falls back to global LSP binary when project binary is untrusted and skipped', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-lsp-'));
		const file = join(root, 'src', 'main.ts');
		dirs.push(root);
		mkdirSync(join(root, 'src'), { recursive: true });
		mkdirSync(join(root, 'node_modules', '.bin'), {
			recursive: true,
		});
		writeFileSync(join(root, 'package.json'), '{}\n');
		writeFileSync(file, 'export const value = 1;\n');
		writeFileSync(
			join(
				root,
				'node_modules',
				'.bin',
				'typescript-language-server',
			),
			'#!/bin/sh\n',
			{ mode: 0o755 },
		);
		const create_client = vi.fn(() => create_mock_client());
		const { pi, tools } = create_test_pi();
		const { ctx, selections } = create_command_context();
		selections.push('Use global PATH binary instead');

		await create_lsp_extension({
			create_client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => root,
		})(pi);

		await tools
			.get('lsp_hover')
			.execute(
				'1',
				{ file, line: 0, character: 0 },
				undefined,
				undefined,
				ctx,
			);

		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({
				command: 'typescript-language-server',
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

		await create_lsp_extension({
			create_client,
			read_file: async () => '<script lang="ts">\n</script>\n',
			cwd: () => '/repo/not-the-target',
		})(pi);

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
