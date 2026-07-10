import { describe, expect, it } from 'vitest';
import { create_context_store } from '../../test/support.js';
import { ContextStore } from '../store.js';
import {
	context_store_chunk_summary,
	context_store_get,
} from './retrieval.js';

function create_store(): ContextStore {
	return create_context_store(
		{ max_bytes: 10 },
		'pi-context-retrieval-',
	);
}

describe('context store retrieval helpers', () => {
	it('summarizes chunks and resolves numeric chunk references', () => {
		const store = create_store();
		const stored = store.store({
			text: `needle-retrieval\n${'x '.repeat(5000)}`,
			tool_name: 'bash',
		});

		const summary = context_store_chunk_summary(
			store,
			stored!.source_id,
		);
		expect(summary?.chunk_count).toBe(stored!.chunk_count);
		expect(summary?.first_chunk_id).toBe(stored!.first_chunk_id);

		const first = context_store_get(store, stored!.source_id, '1');
		expect(first).toHaveLength(1);
		expect(first[0]!.id).toBe(stored!.first_chunk_id);
	});
});
