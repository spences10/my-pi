import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LspClientStartError } from '../lsp/client.js';
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

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

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

function create_deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
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
			'lsp_diagnostics_many',
			'lsp_document_symbols',
			'lsp_find_symbol',
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

		await create_lsp_extension({
			create_client,
			read_file: async () => '<script lang="ts">\n</script>\n',
			cwd: () => '/repo/not-the-target',
		})(pi);

		await tools.get('lsp_hover').execute('1', {
			file,
			line: 0,
			character: 0,
		});

		expect(create_client).toHaveBeenCalledWith(
			expect.objectContaining({
				command: join(root, 'node_modules', '.bin', 'svelteserver'),
				root_uri: `file://${app}`,
			}),
		);
	});

	it('finds symbols by query within a file', async () => {
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
							name: 'renderWidget',
							kind: 6,
							detail: 'widget helper',
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
				{
					name: 'widgetFactory',
					kind: 12,
					range: {
						start: { line: 12, character: 0 },
						end: { line: 15, character: 0 },
					},
					selectionRange: {
						start: { line: 12, character: 0 },
						end: { line: 12, character: 13 },
					},
				},
			]),
		});
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export class Widget {}\n',
			cwd: () => '/repo',
		})(pi);

		const result = await tools.get('lsp_find_symbol').execute('1', {
			file: 'src/file.ts',
			query: 'widget',
		});

		expect(result.content[0].text).toContain(
			'/repo/src/file.ts: 3 symbol match(es) for "widget"',
		);
		expect(result.content[0].text).toContain(
			'class Widget — class @ 1:1',
		);
		expect(result.content[0].text).toContain(
			'method renderWidget — widget helper @ 3:2',
		);
		expect(result.content[0].text).toContain(
			'function widgetFactory @ 13:1',
		);
	});

	it('supports exact, top-level-only, and kind-filtered symbol search', async () => {
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
							name: 'Widget',
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
				{
					name: 'Widget',
					kind: 12,
					range: {
						start: { line: 12, character: 0 },
						end: { line: 15, character: 0 },
					},
					selectionRange: {
						start: { line: 12, character: 0 },
						end: { line: 12, character: 6 },
					},
				},
			]),
		});
		const { pi, tools } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export class Widget {}\n',
			cwd: () => '/repo',
		})(pi);

		const top_level = await tools
			.get('lsp_find_symbol')
			.execute('1', {
				file: 'src/file.ts',
				query: 'Widget',
				exact_match: true,
				top_level_only: true,
				kinds: ['class'],
			});
		expect(top_level.content[0].text).toContain(
			'/repo/src/file.ts: 1 symbol match(es) for "Widget"',
		);
		expect(top_level.content[0].text).toContain(
			'class Widget — class @ 1:1',
		);
		expect(top_level.content[0].text).not.toContain('method Widget');
		expect(top_level.content[0].text).not.toContain(
			'function Widget',
		);

		const methods = await tools.get('lsp_find_symbol').execute('2', {
			file: 'src/file.ts',
			query: 'Widget',
			exact_match: true,
			kinds: ['method'],
		});
		expect(methods.content[0].text).toContain('method Widget @ 3:2');
		expect(methods.content[0].text).not.toContain('class Widget');
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

		const first_hover = tools.get('lsp_hover').execute('1', {
			file: 'src/file.ts',
			line: 0,
			character: 0,
		});

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

		const second_hover = await tools.get('lsp_hover').execute('2', {
			file: 'src/file.ts',
			line: 0,
			character: 0,
		});
		expect(second_hover.content[0].text).toBe('second hover');
		expect(create_client).toHaveBeenCalledTimes(2);
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
