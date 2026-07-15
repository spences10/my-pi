import { describe, expect, it } from 'vitest';
import { should_inject_omnisearch_prompt } from './index.js';

describe('should_inject_omnisearch_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {},
			} as Parameters<typeof should_inject_omnisearch_prompt>[0]),
		).toBe(true);
	});

	it('injects when mcp-omnisearch is active', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__mcp-omnisearch__web_search'],
				},
			} as Parameters<typeof should_inject_omnisearch_prompt>[0]),
		).toBe(true);
	});

	it('injects for omnisearch MCP tools even when the server is aliased', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__omnisearch__web_extract'],
				},
			} as Parameters<typeof should_inject_omnisearch_prompt>[0]),
		).toBe(true);
	});

	it('skips injection when omnisearch MCP tools are unavailable', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['read', 'bash'],
				},
			} as Parameters<typeof should_inject_omnisearch_prompt>[0]),
		).toBe(false);
	});

	it('skips similarly named tools from non-omnisearch MCP servers', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__search__web_search'],
				},
			} as Parameters<typeof should_inject_omnisearch_prompt>[0]),
		).toBe(false);
	});
});
