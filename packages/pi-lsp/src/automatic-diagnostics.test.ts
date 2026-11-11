import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	create_command_context,
	create_deferred,
	create_mock_client,
	create_test_lsp_extension,
	dirs,
} from '../test/support.js';
import type { LspDiagnostic } from './client.js';
import type { LspClientLike } from './server-manager.js';

async function setup(overrides: Partial<LspClientLike> = {}) {
	const root = mkdtempSync(join(tmpdir(), 'my-pi-auto-lsp-'));
	dirs.push(root);
	mkdirSync(join(root, 'node_modules', 'typescript'), {
		recursive: true,
	});
	writeFileSync(join(root, 'package.json'), '{}');
	writeFileSync(
		join(root, 'node_modules', 'typescript', 'package.json'),
		JSON.stringify({ version: '6.0.3' }),
	);
	const close_document = vi.fn().mockResolvedValue(undefined);
	const ensure_document_open = vi.fn().mockResolvedValue(undefined);

	const client = create_mock_client({
		close_document,
		ensure_document_open,
		...overrides,
	});

	const create_client = vi.fn(() => client);
	const read_file = vi.fn(async () => 'export const value = 1;');

	const test_pi = await create_test_lsp_extension({
		create_client,
		read_file,
		cwd: () => root,
	});

	const { ctx } = create_command_context();

	return {
		...test_pi,
		root,
		close_document,
		ensure_document_open,
		create_client,
		read_file,
		ctx,
	};
}

function boundary(outcome = 'completed') {
	return { outcome, entries: [] };
}

describe('automatic LSP diagnostics', () => {
	it('batches successful edits and nested codemode writes using the final contents', async () => {
		const {
			events,
			root,
			close_document,
			ensure_document_open,
			create_client,
			read_file,
			ctx,
		} = await setup();

		const record = events.get('tool_result');
		record({
			toolName: 'edit',
			input: { path: 'src/a.ts' },
			isError: false,
		});
		record({
			toolName: 'write',
			input: { path: join(root, 'src/a.ts') },
			isError: false,
			parentToolCallId: 'codemode-1',
		});
		record({
			toolName: 'write',
			input: { path: 'src/b.ts' },
			isError: false,
		});
		read_file.mockResolvedValue('export const final_value = 2;');
		expect(create_client).not.toHaveBeenCalled();
		expect(read_file).not.toHaveBeenCalled();

		const previous = { type: 'custom', customType: 'keep', data: {} };

		const result = await events.get('turn_end')(
			{
				...boundary(),
				entries: [previous],
			},
			ctx,
		);

		expect(result.entries[0]).toBe(previous);
		expect(result.entries[1]).toMatchObject({
			type: 'custom_message',
			customType: 'lsp-diagnostics',
			display: true,
		});
		expect(result.entries[1].content).toContain(
			'2 file(s): 0 diagnostic(s), 2 clean',
		);
		expect(result.entries[1].content).toContain(
			join(root, 'src/a.ts'),
		);
		expect(result.entries[1].content).toContain(
			join(root, 'src/b.ts'),
		);
		expect(result.continue).toBe(true);
		expect(read_file).toHaveBeenCalledTimes(2);
		expect(ensure_document_open).toHaveBeenCalledWith(
			expect.any(String),
			'export const final_value = 2;',
		);
		expect(close_document).not.toHaveBeenCalled();
		expect(
			await events.get('turn_end')(boundary(), ctx),
		).toBeUndefined();
	});

	it('ignores failed edits, unsupported files, reads, and Bash changes', async () => {
		const { events, create_client, ctx } = await setup();

		for (const [tool_name, path, is_error] of [
			['edit', 'src/a.ts', true],
			['write', 'src/a.ts', true],
			['write', 'README.md', false],
			['read', 'src/a.ts', false],
			['bash', 'src/a.ts', false],
		] as const) {
			events.get('tool_result')({
				toolName: tool_name,
				input: { path },
				isError: is_error,
			});
		}

		expect(
			await events.get('turn_end')(boundary(), ctx),
		).toBeUndefined();
		expect(create_client).not.toHaveBeenCalled();
	});

	it('reports errors, warnings, incomplete validation, and server failures without treating them as clean', async () => {
		const diagnostics: LspDiagnostic[] = ([1, 2] as const).map(
			(severity) => ({
				severity,
				message: severity === 1 ? 'Type error' : 'Warning',
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 1 },
				},
			}),
		);

		const wait_for_diagnostics = vi
			.fn()
			.mockResolvedValueOnce(diagnostics)
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error('server unavailable'));

		const { events, close_document, ctx } = await setup({
			wait_for_diagnostics,
		});

		for (const path of ['a.ts', 'b.ts', 'c.ts']) {
			events.get('tool_result')({
				toolName: 'edit',
				input: { path },
				isError: false,
			});
		}

		const result = await events.get('turn_end')(boundary(), ctx);
		const text = result.entries[0].content;
		expect(text).toContain(
			'2 diagnostic(s), 0 clean, 1 error(s), 1 incomplete',
		);
		expect(text).toContain('Type error');
		expect(text).toContain('Warning');
		expect(text).toContain('validation incomplete');
		expect(text).toContain('server unavailable');
		expect(close_document).not.toHaveBeenCalled();
	});

	it('waits at the turn boundary for diagnostics before allowing the next response', async () => {
		const deferred = create_deferred<LspDiagnostic[] | null>();
		const wait_for_diagnostics = vi.fn(() => deferred.promise);
		const { events, ctx } = await setup({ wait_for_diagnostics });
		events.get('tool_result')({
			toolName: 'write',
			input: { path: 'a.ts' },
			isError: false,
		});
		let finished = false;

		const pending = events
			.get('turn_end')(boundary(), ctx)
			.then((result: unknown) => {
				finished = true;

				return result;
			});

		await vi.waitFor(() =>
			expect(wait_for_diagnostics).toHaveBeenCalledTimes(1),
		);
		expect(finished).toBe(false);
		deferred.resolve([]);
		expect(await pending).toMatchObject({ continue: true });
	});

	it.each(['aborted', 'error'])(
		'drops pending diagnostics after a %s turn',
		async (outcome) => {
			const { events, create_client, ctx } = await setup();
			events.get('tool_result')({
				toolName: 'edit',
				input: { path: 'a.ts' },
				isError: false,
			});
			expect(
				await events.get('turn_end')(boundary(outcome), ctx),
			).toBeUndefined();
			expect(
				await events.get('turn_end')(boundary(), ctx),
			).toBeUndefined();
			expect(create_client).not.toHaveBeenCalled();
		},
	);

	it.each(['session_start', 'session_shutdown'])(
		'drops pending diagnostics on %s',
		async (event_name) => {
			const { events, create_client, ctx } = await setup();
			events.get('tool_result')({
				toolName: 'edit',
				input: { path: 'a.ts' },
				isError: false,
			});
			await events.get(event_name)({}, ctx);
			expect(
				await events.get('turn_end')(boundary(), ctx),
			).toBeUndefined();
			expect(create_client).not.toHaveBeenCalled();
		},
	);

	it.each(['session_shutdown', 'abort'])(
		'does not publish late results after %s',
		async (reason) => {
			const deferred = create_deferred<LspDiagnostic[] | null>();
			const wait_for_diagnostics = vi.fn(() => deferred.promise);

			const { events, close_document, ctx } = await setup({
				wait_for_diagnostics,
			});

			const controller = new AbortController();
			events.get('tool_result')({
				toolName: 'write',
				input: { path: 'a.ts' },
				isError: false,
			});

			const pending = events.get('turn_end')(boundary(), {
				...ctx,
				signal: controller.signal,
			});

			await vi.waitFor(() =>
				expect(wait_for_diagnostics).toHaveBeenCalledTimes(1),
			);

			if (reason === 'abort') controller.abort();
			else await events.get('session_shutdown')({}, ctx);
			deferred.resolve([]);
			expect(await pending).toBeUndefined();
			expect(close_document).not.toHaveBeenCalled();
		},
	);
});
