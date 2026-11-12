import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import {
	definition_result_schema,
	diagnostic_result_schema,
	document_symbols_result_schema,
	hover_result_schema,
	initialize_result_schema,
	references_result_schema,
} from './response-schemas.js';

const range = {
	start: { line: 0, character: 0 },
	end: { line: 1, character: 0 },
};

const location = { uri: 'file:///repo/a.ts', range };

// Exercise wire values, not asserted SDK-shaped objects.
describe('LSP response schemas', () => {
	it('accepts null results and initialization capabilities', () => {
		expect(
			v.parse(initialize_result_schema, {
				capabilities: { diagnosticProvider: {} },
			}),
		).toEqual({ capabilities: { diagnosticProvider: {} } });
		expect(v.parse(hover_result_schema, null)).toBeNull();
		expect(v.parse(references_result_schema, null)).toBeNull();
	});

	it('keeps marked strings, markdown and location links', () => {
		const hover = {
			contents: [
				'plain',
				{ language: 'ts', value: 'const x = 1' },
				{ kind: 'markdown', value: '**x**' },
			],
			range,
		};

		expect(v.parse(hover_result_schema, hover)).toEqual(hover);

		const links = [
			{
				targetUri: location.uri,
				targetRange: range,
				targetSelectionRange: range,
			},
		];

		expect(v.parse(definition_result_schema, links)).toEqual(links);
		expect(v.parse(references_result_schema, [location])).toEqual([
			location,
		]);
	});

	it('accepts recursive document symbols and flat symbol information', () => {
		const child = {
			name: 'child',
			kind: 13,
			range,
			selectionRange: range,
		};

		const symbols = [
			{
				name: 'parent',
				kind: 5,
				range,
				selectionRange: range,
				children: [child],
			},
		];

		expect(v.parse(document_symbols_result_schema, symbols)).toEqual(
			symbols,
		);
		const flat = [{ name: 'x', kind: 13, location }];
		expect(v.parse(document_symbols_result_schema, flat)).toEqual(
			flat,
		);
	});

	it('rejects malformed nested results instead of exposing them to callers', () => {
		expect(
			v.safeParse(hover_result_schema, { contents: 42 }).success,
		).toBe(false);
		expect(
			v.safeParse(references_result_schema, [
				{ ...location, range: null },
			]).success,
		).toBe(false);
		expect(
			v.safeParse(document_symbols_result_schema, [
				{
					name: 'x',
					kind: 5,
					range,
					selectionRange: range,
					children: [{ name: 42 }],
				},
			]).success,
		).toBe(false);
		expect(
			v.safeParse(diagnostic_result_schema, {
				items: [{ range, message: 42 }],
			}).success,
		).toBe(false);
	});
});
