import { describe, expect, it, vi } from 'vitest';
import {
	create_mock_client,
	create_test_pi,
} from '../test/support.js';
import { create_lsp_extension } from './index.js';

describe('lsp symbol tools', () => {
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
