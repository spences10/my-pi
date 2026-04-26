import { describe, expect, it } from 'vitest';
import { should_inject_omnisearch_prompt } from './index.js';

describe('should_inject_omnisearch_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {},
			} as any),
		).toBe(true);
	});

	it('injects when mcp-omnisearch is active', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__mcp-omnisearch__web_search'],
				},
			} as any),
		).toBe(true);
	});

	it('injects for omnisearch MCP tools even when the server is aliased', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__omnisearch__web_extract'],
				},
			} as any),
		).toBe(true);
	});

	it('skips injection when omnisearch MCP tools are unavailable', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['read', 'bash'],
				},
			} as any),
		).toBe(false);
	});

	it('skips similarly named tools from non-omnisearch MCP servers', () => {
		expect(
			should_inject_omnisearch_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__search__web_search'],
				},
			} as any),
		).toBe(false);
	});
});
