import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { register_context_tools } from './index.js';

describe('register_context_tools', () => {
	it('registers all context tools in a stable order', () => {
		const tools: Array<{
			name: string;
			constrainedSampling?: unknown;
		}> = [];
		register_context_tools({
			registerTool(tool: {
				name: string;
				constrainedSampling?: unknown;
			}) {
				tools.push(tool);
			},
		} as unknown as ExtensionAPI);

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
