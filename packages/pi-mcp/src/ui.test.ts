import { describe, expect, it } from 'vite-plus/test';
import type { ServerState } from './server-state.js';
import { format_mcp_server_list } from './ui.js';

describe('packages/pi-mcp/src/ui.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./ui.js')).resolves.toBeDefined();
	});

	it('formats an empty server list', () => {
		expect(format_mcp_server_list(new Map())).toBe(
			'No MCP servers configured',
		);
	});

	it('includes server status and tool count', () => {
		const servers = new Map<string, ServerState>([
			[
				'docs',
				{
					config: {
						name: 'docs',
						transport: 'stdio',
						command: 'node',
						disabled: false,
					},
					enabled: true,
					status: 'connected',
					tool_names: ['mcp__docs__search'],
				} as ServerState,
			],
		]);

		expect(format_mcp_server_list(servers)).toContain(
			'docs (enabled) — 1 tools',
		);
	});
});
