import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { register_context_tools } from './index.js';

describe('register_context_tools', () => {
	it('registers all context tools in a stable order', () => {
		const names: string[] = [];
		register_context_tools({
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
		} as unknown as ExtensionAPI);

		expect(names).toEqual([
			'context_search',
			'context_get',
			'context_export',
			'context_list',
			'context_stats',
			'context_purge',
		]);
	});
});
