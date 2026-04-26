import { describe, expect, it } from 'vitest';
import {
	LspClient,
	LspClientStartError,
	normalize_document_symbol_result,
	normalize_location_result,
} from './client.js';

describe('LspClient.start', () => {
	it('rejects quickly with a typed error when the server binary is missing', async () => {
		const client = new LspClient({
			command: '__my_pi_missing_lsp_binary__',
			args: ['--stdio'],
			root_uri: 'file:///repo',
			language_id_for_uri: () => 'typescript',
			request_timeout_ms: 50,
		});

		await expect(client.start()).rejects.toMatchObject({
			name: 'LspClientStartError',
			command: '__my_pi_missing_lsp_binary__',
			code: 'ENOENT',
		});
		await expect(client.start()).rejects.toBeInstanceOf(
			LspClientStartError,
		);
	});
});

describe('normalize_location_result', () => {
	it('keeps regular locations as-is', () => {
		expect(
			normalize_location_result({
				uri: 'file:///repo/a.ts',
				range: {
					start: { line: 1, character: 2 },
					end: { line: 1, character: 3 },
				},
			}),
		).toEqual([
			{
				uri: 'file:///repo/a.ts',
				range: {
					start: { line: 1, character: 2 },
					end: { line: 1, character: 3 },
				},
			},
		]);
	});

	it('converts location links to regular locations using targetSelectionRange', () => {
		expect(
			normalize_location_result([
				{
					targetUri: 'file:///repo/b.ts',
					targetRange: {
						start: { line: 10, character: 0 },
						end: { line: 20, character: 0 },
					},
					targetSelectionRange: {
						start: { line: 12, character: 4 },
						end: { line: 12, character: 10 },
					},
				},
			]),
		).toEqual([
			{
				uri: 'file:///repo/b.ts',
				range: {
					start: { line: 12, character: 4 },
					end: { line: 12, character: 10 },
				},
			},
		]);
	});
});

describe('normalize_document_symbol_result', () => {
	it('converts SymbolInformation-like entries into document symbols', () => {
		expect(
			normalize_document_symbol_result([
				{
					name: 'thing',
					kind: 13,
					containerName: 'module',
					location: {
						uri: 'file:///repo/c.ts',
						range: {
							start: { line: 4, character: 1 },
							end: { line: 4, character: 6 },
						},
					},
				},
			]),
		).toEqual([
			{
				name: 'thing',
				kind: 13,
				containerName: 'module',
				uri: 'file:///repo/c.ts',
				range: {
					start: { line: 4, character: 1 },
					end: { line: 4, character: 6 },
				},
				selectionRange: {
					start: { line: 4, character: 1 },
					end: { line: 4, character: 6 },
				},
			},
		]);
	});
});
