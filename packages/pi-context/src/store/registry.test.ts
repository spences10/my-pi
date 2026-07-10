import { afterEach, describe, expect, it } from 'vitest';
import { temp_db } from '../../test/support.js';
import { ContextStore } from '../store.js';
import {
	get_context_store,
	maybe_store_context_output,
	set_context_sidecar_enabled,
} from './registry.js';

afterEach(() => {
	set_context_sidecar_enabled(false);
});

describe('context store registry', () => {
	it('gates writes on enablement and reconfigures a reused store', () => {
		const db_path = temp_db('pi-context-registry-');
		expect(
			maybe_store_context_output(ContextStore, {
				text: 'disabled '.repeat(20),
				tool_name: 'bash',
			}),
		).toBeNull();

		set_context_sidecar_enabled(true, {
			db_path,
			max_bytes: 10,
			project_path: '/project-a',
		});
		maybe_store_context_output(ContextStore, {
			text: `alpha-registry\n${'x '.repeat(100)}`,
			tool_name: 'bash',
		});
		const first = get_context_store(ContextStore);

		set_context_sidecar_enabled(true, {
			db_path,
			max_bytes: 10,
			project_path: '/project-b',
		});
		maybe_store_context_output(ContextStore, {
			text: `beta-registry\n${'x '.repeat(100)}`,
			tool_name: 'bash',
		});
		const second = get_context_store(ContextStore);

		expect(second).toBe(first);
		expect(second.search('alpha-registry')).toHaveLength(0);
		expect(second.search('beta-registry')).toHaveLength(1);
		expect(
			second.search('alpha-registry', { project_path: '/project-a' }),
		).toHaveLength(1);
		second.close();
	});
});
