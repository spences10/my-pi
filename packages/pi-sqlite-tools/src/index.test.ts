import { describe, expect, it } from 'vitest';
import { should_inject_sqlite_tools_prompt } from './index.js';

describe('should_inject_sqlite_tools_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_sqlite_tools_prompt({
				systemPromptOptions: {},
			} as any),
		).toBe(true);
	});

	it('injects when mcp-sqlite-tools is active', () => {
		expect(
			should_inject_sqlite_tools_prompt({
				systemPromptOptions: {
					selectedTools: [
						'read',
						'mcp__mcp-sqlite-tools__open_database',
					],
				},
			} as any),
		).toBe(true);
	});

	it('injects for sqlite MCP tools even when the server is aliased', () => {
		expect(
			should_inject_sqlite_tools_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__sqlite__execute_read_query'],
				},
			} as any),
		).toBe(true);
	});

	it('skips injection when sqlite MCP tools are unavailable', () => {
		expect(
			should_inject_sqlite_tools_prompt({
				systemPromptOptions: {
					selectedTools: ['read', 'bash'],
				},
			} as any),
		).toBe(false);
	});

	it('skips similarly named tools from non-sqlite MCP servers', () => {
		expect(
			should_inject_sqlite_tools_prompt({
				systemPromptOptions: {
					selectedTools: ['mcp__postgres__execute_read_query'],
				},
			} as any),
		).toBe(false);
	});
});
