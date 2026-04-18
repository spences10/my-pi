import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { create_lsp_extension, type LspClientLike } from './lsp.js';

function create_mock_client(
	overrides: Partial<LspClientLike> = {},
): LspClientLike {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		is_ready: vi.fn().mockReturnValue(true),
		ensure_document_open: vi.fn().mockResolvedValue(undefined),
		hover: vi.fn().mockResolvedValue(null),
		definition: vi.fn().mockResolvedValue([]),
		references: vi.fn().mockResolvedValue([]),
		document_symbols: vi.fn().mockResolvedValue([]),
		wait_for_diagnostics: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

function create_test_pi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any>();

	const pi = {
		registerTool(definition: any) {
			tools.set(definition.name, definition);
		},
		registerCommand(name: string, definition: any) {
			commands.set(name, definition);
		},
		on(name: string, handler: any) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;

	return { pi, tools, commands, events };
}

function create_command_context() {
	const notifications: Array<{ message: string; level?: string }> =
		[];
	return {
		ctx: {
			ui: {
				notify(message: string, level?: string) {
					notifications.push({ message, level });
				},
			},
		} as any,
		notifications,
	};
}

describe('lsp extension', () => {
	it('registers the LSP tools and /lsp command', async () => {
		const client = create_mock_client();
		const { pi, tools, commands, events } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		expect(Array.from(tools.keys()).sort()).toEqual([
			'lsp_definition',
			'lsp_diagnostics',
			'lsp_document_symbols',
			'lsp_hover',
			'lsp_references',
		]);
		expect(commands.has('lsp')).toBe(true);
		expect(events.has('session_shutdown')).toBe(true);
	});

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

	it('formats document symbols for the agent', async () => {
		const client = create_mock_client({
			document_symbols: vi.fn().mockResolvedValue([
				{
					name: 'Widget',
					kind: 5,
					detail: 'class',
					range: {
						start: { line: 0, character: 0 },
						end: { line: 10, character: 0 },
					},
					selectionRange: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 6 },
					},
					children: [
						{
							name: 'render',
							kind: 6,
							range: {
								start: { line: 2, character: 1 },
								end: { line: 5, character: 1 },
							},
							selectionRange: {
								start: { line: 2, character: 1 },
								end: { line: 2, character: 7 },
							},
						},
					],
				},
			]),
		});
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export class Widget {}\n',
			cwd: () => '/repo',
		})(pi);

		const result = await tools
			.get('lsp_document_symbols')
			.execute('1', {
				file: 'src/file.ts',
			});
		const text = result.content[0].text;

		expect(text).toContain(
			'/repo/src/file.ts: 1 top-level symbol(s)',
		);
		expect(text).toContain('class Widget — class @ 1:1');
		expect(text).toContain('method render @ 3:2');
	});
});
