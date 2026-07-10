import { describe, expect, it } from 'vitest';
import { create_context_store } from '../../test/support.js';
import { ContextStore } from '../store.js';
import {
	context_store_purge_with_details,
	context_store_stats,
} from './maintenance.js';

function create_store(): ContextStore {
	return create_context_store(
		{ max_bytes: 10, project_path: '/project-a' },
		'pi-context-maintenance-',
	);
}

describe('context store maintenance helpers', () => {
	it('reports scoped stats and purges matching sources with details', () => {
		const store = create_store();
		const stored = store.store({
			text: `maintenance-token\n${'x '.repeat(100)}`,
			tool_name: 'bash',
		});

		expect(
			context_store_stats(store, { project_path: '/project-a' })
				.sources,
		).toBe(1);
		expect(
			context_store_stats(store, { project_path: '/project-b' })
				.sources,
		).toBe(0);

		const details = context_store_purge_with_details(store, {
			source_id: stored!.source_id,
		});
		expect(details).toMatchObject({
			deleted: 1,
			source_id: stored!.source_id,
		});
		expect(context_store_stats(store).sources).toBe(0);
	});
});
