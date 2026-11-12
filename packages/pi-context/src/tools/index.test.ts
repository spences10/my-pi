import { describe, expect, it, vi } from 'vite-plus/test';
import { make_api } from '../../../../tools/test-sdk.js';
import { register_context_tools } from './index.js';

describe('register_context_tools', () => {
	it('registers all context tools in a stable order', () => {
		const pi = make_api();
		const register_tool = vi.spyOn(pi, 'registerTool');
		register_context_tools(pi);
		const tools = register_tool.mock.calls.map(([tool]) => tool);

		expect(tools.map((tool) => tool.name)).toEqual([
			'context_search',
			'context_get',
			'context_export',
			'context_list',
			'context_stats',
			'context_purge',
		]);
		expect(
			tools.every((tool) => tool.constrainedSampling === undefined),
		).toBe(true);
	});
});
