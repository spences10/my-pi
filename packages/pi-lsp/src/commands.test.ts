import { describe, expect, it, vi } from 'vitest';
import {
	create_command_context,
	create_deferred,
	create_mock_client,
	create_test_pi,
} from '../test/support.js';
import { create_lsp_extension } from './index.js';

describe('lsp command', () => {
	it('reports idle, running, and restarted server state via /lsp', async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const client = create_mock_client({
			hover: vi.fn().mockResolvedValue({ contents: 'hover docs' }),
			stop,
		});
		const { pi, tools, commands } = create_test_pi();
		const { ctx, notifications } = create_command_context();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		await commands.get('lsp').handler('', ctx);
		expect(notifications.pop()?.message).toContain(
			'typescript: idle — typescript-language-server',
		);

		await tools.get('lsp_hover').execute('1', {
			file: 'src/file.ts',
			line: 0,
			character: 0,
		});
		await commands.get('lsp').handler('status', ctx);
		expect(notifications.pop()?.message).toContain(
			'typescript: running (ready=true) — typescript-language-server',
		);

		await commands.get('lsp').handler('restart typescript', ctx);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(notifications.pop()?.message).toBe(
			'Restarted typescript language server state.',
		);
	});

	it('offers restart all directly from the modal home', async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const client = create_mock_client({
			hover: vi.fn().mockResolvedValue({ contents: 'hover docs' }),
			stop,
		});
		const { pi, tools, commands } = create_test_pi();
		const { ctx, notifications } = create_command_context([
			'restart-all',
			undefined,
		]);

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		await tools.get('lsp_hover').execute('1', {
			file: 'src/file.ts',
			line: 0,
			character: 0,
		});
		await commands.get('lsp').handler('', ctx);

		expect(stop).toHaveBeenCalledTimes(1);
		expect(notifications.pop()?.message).toBe(
			'Restarted all language server state.',
		);
	});

	it('does not reuse a cancelled in-flight startup after restart', async () => {
		const startup = create_deferred<void>();
		const stop_first = vi.fn().mockResolvedValue(undefined);
		const first_client = create_mock_client({
			start: vi.fn(() => startup.promise),
			stop: stop_first,
		});
		const second_client = create_mock_client({
			hover: vi.fn().mockResolvedValue({ contents: 'second hover' }),
		});
		const create_client = vi
			.fn()
			.mockReturnValueOnce(first_client)
			.mockReturnValueOnce(second_client);
		const { pi, tools, commands } = create_test_pi();
		const { ctx, notifications } = create_command_context();

		await create_lsp_extension({
			create_client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		const first_hover = tools.get('lsp_hover').execute(
			'1',
			{
				file: 'src/file.ts',
				line: 0,
				character: 0,
			},
			undefined,
			undefined,
			ctx,
		);

		await commands.get('lsp').handler('restart typescript', ctx);
		startup.resolve();

		const cancelled = await first_hover;
		expect(cancelled.content[0].text).toContain(
			'Startup cancelled for typescript LSP in /repo',
		);
		expect(stop_first).toHaveBeenCalledTimes(1);
		expect(notifications.pop()?.message).toBe(
			'Restarted typescript language server state.',
		);

		const second_hover = await tools.get('lsp_hover').execute(
			'2',
			{
				file: 'src/file.ts',
				line: 0,
				character: 0,
			},
			undefined,
			undefined,
			ctx,
		);
		expect(second_hover.content[0].text).toBe('second hover');
		expect(create_client).toHaveBeenCalledTimes(2);
	});
});
