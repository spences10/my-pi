import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from './client.js';
import {
	count_pending_enabled_servers,
	create_server_states,
	format_server_status,
	format_server_target,
	get_mcp_idle_timeout_ms,
	remove_server_tools_from_active,
	summarize_mcp_tool_params,
} from './server-state.js';

const stdio_config: McpServerConfig = {
	name: 'local',
	transport: 'stdio',
	command: 'node',
	args: ['server.js'],
};

const http_config: McpServerConfig = {
	name: 'remote',
	transport: 'http',
	url: 'https://user:pass@example.com/mcp?token=secret&safe=ok',
};

const original_idle_timeout = process.env.MY_PI_MCP_IDLE_TIMEOUT_MS;

afterEach(() => {
	if (original_idle_timeout === undefined) {
		delete process.env.MY_PI_MCP_IDLE_TIMEOUT_MS;
	} else {
		process.env.MY_PI_MCP_IDLE_TIMEOUT_MS = original_idle_timeout;
	}
});

describe('mcp server state helpers', () => {
	it('creates enabled state from configs', () => {
		const states = create_server_states([
			stdio_config,
			{ ...http_config, disabled: true },
		]);

		expect(states.get('local')).toMatchObject({
			enabled: true,
			status: 'disconnected',
			tool_names: [],
		});
		expect(states.get('remote')).toMatchObject({ enabled: false });
	});

	it('formats server status and pending counts', () => {
		const states = create_server_states([stdio_config, http_config]);
		states.get('local')!.status = 'connected';
		states.get('remote')!.status = 'failed';

		expect(format_server_status(states.get('local')!)).toBe(
			'enabled',
		);
		expect(format_server_status(states.get('remote')!)).toBe(
			'failed',
		);
		expect(count_pending_enabled_servers(states)).toBe(1);
	});

	it('redacts sensitive http targets and preserves stdio targets', () => {
		expect(format_server_target(http_config)).toContain('token=***');
		expect(format_server_target(http_config)).not.toContain('secret');
		expect(format_server_target(stdio_config)).toBe('node server.js');
	});

	it('summarizes long tool params', () => {
		const summary = summarize_mcp_tool_params({
			value: 'x'.repeat(600),
		});

		expect(summary).toHaveLength(500);
		expect(summary?.endsWith('...')).toBe(true);
	});

	it('defaults to a 15 minute idle timeout', () => {
		const states = create_server_states([stdio_config]);

		expect(get_mcp_idle_timeout_ms(states.get('local')!)).toBe(
			15 * 60_000,
		);
	});

	it('allows config and env idle timeout overrides', () => {
		const states = create_server_states([
			{ ...stdio_config, idle_timeout_ms: 123 },
			http_config,
		]);
		process.env.MY_PI_MCP_IDLE_TIMEOUT_MS = '456';

		expect(get_mcp_idle_timeout_ms(states.get('local')!)).toBe(123);
		expect(get_mcp_idle_timeout_ms(states.get('remote')!)).toBe(456);
	});

	it('allows disabling idle shutdown with a zero env timeout', () => {
		const states = create_server_states([stdio_config]);
		process.env.MY_PI_MCP_IDLE_TIMEOUT_MS = '0';

		expect(
			get_mcp_idle_timeout_ms(states.get('local')!),
		).toBeUndefined();
	});

	it('removes server tools from active tools', () => {
		const setActiveTools = vi.fn();
		remove_server_tools_from_active(
			{
				getActiveTools: () => ['a', 'mcp__x__one', 'b'],
				setActiveTools,
			} as unknown as Parameters<
				typeof remove_server_tools_from_active
			>[0],
			['mcp__x__one'],
		);

		expect(setActiveTools).toHaveBeenCalledWith(['a', 'b']);
	});
});
