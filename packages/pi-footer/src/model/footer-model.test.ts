import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	make_context,
	make_footer_data,
	test_theme,
} from '../test-utils.js';
import { build_footer_model } from './footer-model.js';

const original_home = process.env.HOME;

function restore_home() {
	if (original_home === undefined) delete process.env.HOME;
	else process.env.HOME = original_home;
}

describe('build_footer_model', () => {
	afterEach(() => {
		restore_home();
	});

	it('builds path, stats, model, and status data', () => {
		process.env.HOME = '/home/scott';
		const ctx = make_context({
			sessionManager: {
				getEntries: vi.fn(() => [
					{
						type: 'message',
						message: {
							role: 'assistant',
							usage: {
								input: 1200,
								output: 3400,
								cacheRead: 500,
								cacheWrite: 100,
								cost: { total: 0.1234 },
							},
						},
					},
					{
						type: 'message',
						message: {
							role: 'toolResult',
							usage: {
								input: 100,
								output: 100,
								cacheRead: 100,
								cacheWrite: 100,
								cost: { total: 0.02 },
							},
						},
					},
					{
						type: 'compaction',
						usage: {
							input: 100,
							output: 100,
							cacheRead: 100,
							cacheWrite: 100,
							cost: { total: 0.03 },
						},
					},
					{
						type: 'branch_summary',
						usage: {
							input: 100,
							output: 100,
							cacheRead: 100,
							cacheWrite: 100,
							cost: { total: 0.03 },
						},
					},
				]),
				getSessionName: vi.fn(() => 'named'),
			},
		});
		const footer_data = make_footer_data({
			getExtensionStatuses: vi.fn(
				() =>
					new Map([
						['preset', 'prompt:terse'],
						['mcp', 'MCP 6/6 connected'],
					]),
			),
		});

		const model = build_footer_model(ctx, footer_data, test_theme);

		expect(model.path_text).toBe('~/repos/my-pi');
		expect(model.git_text).toContain('main');
		expect(model.session_text).toBe('named');
		expect(model.token_parts).toEqual(
			expect.arrayContaining(['↑1.5k', '↓3.7k', 'R800', 'W400']),
		);
		expect(model.cost_text).toBe('$0.203');
		expect(model.model_text).toContain('claude-sonnet');
		expect(model.preset_status).toBe('prompt:terse');
		expect(model.statuses.get('mcp')).toBe('MCP 6/6 connected');
		expect(model.statuses.has('preset')).toBe(false);
	});
});
