import { describe, expect, it } from 'vitest';
import { format_search_results } from './context-format.js';

const search_result = {
	source_id: 'ctx_test',
	chunk_id: 'ctx_test_0002',
	ordinal: 2,
	title: 'chunk 2',
	content: 'needle snippet',
	tool_name: 'bash',
	created_at: Date.now(),
	bytes: 100,
	lines: 5,
	rank: -1,
	snippet: true,
};

describe('packages/pi-context/src/context-format.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./context-format.js'),
		).resolves.toBeDefined();
	});

	it('guides snippet search toward focused retrieval or offline export', () => {
		const text = format_search_results([search_result]);

		expect(text).toContain(
			'context_get with source_id plus this chunk_id',
		);
		expect(text).toContain('before:1 after:1 (max 3)');
		expect(text).toContain('Prefer context_export');
		expect(text).toContain('rg/jq/Python');
		expect(text).toContain(
			'full_content:true only for small matches',
		);
	});
});
