import { describe, expect, it, vi } from 'vitest';
import {
	create_mock_client,
	create_test_pi,
} from '../test/support.js';
import { LspClientStartError } from './client.js';
import { create_lsp_extension } from './index.js';

describe('lsp diagnostics tools', () => {
	it('returns a friendly message for unsupported files', async () => {
		const start = vi.fn().mockResolvedValue(undefined);
		const client = create_mock_client({ start });
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'ignored',
			cwd: () => '/repo',
		})(pi);

		const result = await tools
			.get('lsp_diagnostics')
			.execute('1', { file: 'notes.txt' });

		expect(result.content[0].text).toBe(
			'No language server configured for /repo/notes.txt',
		);
		expect(start).not.toHaveBeenCalled();
	});

	it('returns a clean error when a language server cannot be started', async () => {
		const client = create_mock_client({
			start: vi.fn().mockRejectedValue(
				new LspClientStartError('Failed to spawn svelteserver', {
					command: 'svelteserver',
					args: ['--stdio'],
					code: 'ENOENT',
				}),
			),
		});
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => '<script lang="ts">\n</script>\n',
			cwd: () => '/repo',
		})(pi);

		const result = await tools.get('lsp_diagnostics').execute('1', {
			file: '/workspace/apps/website/src/routes/+page.svelte',
		});

		expect(result.content[0].text).toContain(
			'svelte LSP unavailable for /workspace/apps/website/src/routes/+page.svelte',
		);
		expect(result.content[0].text).toContain(
			'Reason: command "svelteserver" not found',
		);
		expect(result.content[0].text).toContain(
			'Hint: Install Svelte LSP with: pnpm add -D svelte-language-server (or volta install svelte-language-server)',
		);
		await expect(
			tools.get('lsp_diagnostics').execute('2', {
				file: '/workspace/apps/website/src/routes/+page.svelte',
			}),
		).resolves.toMatchObject({
			content: expect.any(Array),
		});
	});

	it('batches diagnostics across multiple files', async () => {
		const wait_for_diagnostics = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					range: {
						start: { line: 1, character: 4 },
						end: { line: 1, character: 8 },
					},
					severity: 1,
					source: 'ts',
					message: 'Boom',
				},
			]);
		const client = create_mock_client({ wait_for_diagnostics });
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		const result = await tools
			.get('lsp_diagnostics_many')
			.execute('1', {
				files: ['src/a.ts', 'src/b.ts'],
				wait_ms: 500,
			});
		const text = result.content[0].text;

		expect(text).toContain(
			'Checked 2 file(s): 1 diagnostic(s), 1 clean, 0 error(s)',
		);
		expect(text).toContain('/repo/src/a.ts: no diagnostics');
		expect(text).toContain('/repo/src/b.ts: 1 diagnostic(s)');
		expect(text).toContain('2:5 error [ts]: Boom');
		expect(wait_for_diagnostics).toHaveBeenCalledTimes(2);
	});

	it('checks more than ten files without exceeding LSP concurrency', async () => {
		let active = 0;
		let max_active = 0;
		const wait_for_diagnostics = vi.fn(async () => {
			active += 1;
			max_active = Math.max(max_active, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
			return [];
		});
		const client = create_mock_client({ wait_for_diagnostics });
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		const files = Array.from(
			{ length: 12 },
			(_, index) => `src/file-${index}.ts`,
		);
		const result = await tools
			.get('lsp_diagnostics_many')
			.execute('1', { files, wait_ms: 500 });

		expect(result.content[0].text).toContain(
			'Checked 12 file(s): 0 diagnostic(s), 12 clean, 0 error(s)',
		);
		expect(wait_for_diagnostics).toHaveBeenCalledTimes(12);
		expect(max_active).toBeLessThanOrEqual(8);
	});

	it('reports per-file diagnostic failures without failing the whole batch', async () => {
		const wait_for_diagnostics = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error('LSP timed out'))
			.mockResolvedValueOnce([]);
		const client = create_mock_client({ wait_for_diagnostics });
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		const result = await tools
			.get('lsp_diagnostics_many')
			.execute('1', {
				files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
				wait_ms: 500,
			});
		const text = result.content[0].text;

		expect(text).toContain(
			'Checked 3 file(s): 0 diagnostic(s), 2 clean, 1 error(s)',
		);
		expect(text).toContain(
			'typescript LSP unavailable for /repo/src/b.ts',
		);
		expect(text).toContain('Reason: LSP timed out');
	});
});
