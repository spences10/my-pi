import { describe, expect, it } from 'vitest';
import { should_wait_for_mcp_connections } from './index.js';

describe('should_wait_for_mcp_connections', () => {
	it('waits when selected tools are unavailable', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {},
			} as any),
		).toBe(true);
	});

	it('waits when an MCP tool is selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__demo__ping'],
				},
			} as any),
		).toBe(true);
	});

	it('skips blocking when no MCP tools are selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as any),
		).toBe(false);
	});
});
