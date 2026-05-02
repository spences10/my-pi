import { describe, expect, it } from 'vitest';
import type { LspDocumentSymbol } from './client.js';
import {
	find_symbol_matches,
	format_diagnostics,
	format_hover,
	format_symbol_matches,
} from './format.js';

const range = {
	start: { line: 0, character: 0 },
	end: { line: 0, character: 1 },
};

describe('lsp format helpers', () => {
	it('formats diagnostics compactly', () => {
		expect(
			format_diagnostics('/tmp/file.ts', [
				{
					range,
					severity: 1,
					source: 'ts',
					code: 2322,
					message: 'Type mismatch',
				},
			]),
		).toContain('1:1 error [ts] (2322): Type mismatch');
	});

	it('formats empty hover results consistently', () => {
		expect(format_hover(null)).toBe('No hover info.');
		expect(format_hover({ contents: { value: ' docs ' } })).toBe(
			'docs',
		);
	});

	it('finds and formats nested symbol matches', () => {
		const symbols: LspDocumentSymbol[] = [
			{
				name: 'Outer',
				kind: 5,
				range,
				selectionRange: range,
				children: [
					{
						name: 'doWork',
						kind: 12,
						detail: 'helper',
						range,
						selectionRange: range,
					},
				],
			},
		];

		const matches = find_symbol_matches(symbols, 'work', {
			max_results: 10,
			top_level_only: false,
			exact_match: false,
			kinds: new Set(),
		});

		expect(matches).toHaveLength(1);
		expect(
			format_symbol_matches('/tmp/file.ts', 'work', matches),
		).toContain('function doWork — helper @ 1:1');
	});
});
