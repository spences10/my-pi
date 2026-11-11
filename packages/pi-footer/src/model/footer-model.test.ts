import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
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

function cost_model(
	flags: (boolean | undefined)[],
	subscription = false,
) {
	const entries = flags.map((flag, index) => {
		const usage = {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { total: 0.1, totalFromProvider: flag },
		};

		if (index < 2)
			return {
				type: 'message',
				message: {
					role: index === 0 ? 'assistant' : 'toolResult',
					usage,
				},
			};

		return {
			type: index === 2 ? 'compaction' : 'branch_summary',
			usage,
		};
	});

	return build_footer_model(
		make_context({
			sessionManager: {
				getEntries: () => entries,
				getSessionName: () => undefined,
			},
			modelRegistry: { isUsingOAuth: () => subscription },
		}),
		make_footer_data(),
		test_theme,
	);
}

describe('build_footer_model', () => {
	afterEach(() => {
		restore_home();
	});

	it.each([
		{ flags: [true, true, true, true], text: '$0.400 (reported)' },
		{ flags: [false, false, false, false], text: '$0.400 (est)' },
		{
			flags: [undefined, undefined, undefined, undefined],
			text: '$0.400 (est)',
		},
		{ flags: [true, false, true, true], text: '$0.400 (mixed)' },
		{ flags: [true, true, undefined, true], text: '$0.400 (mixed)' },
		{ flags: [true, true, true, false], text: '$0.400 (mixed)' },
	])('labels aggregate cost as $text', ({ flags, text }) => {
		expect(cost_model(flags).cost_text).toBe(text);
	});

	it('keeps subscription status separate from cost provenance', () => {
		expect(cost_model([true, undefined], true).cost_text).toBe(
			'$0.200 (mixed) (sub)',
		);
	});

	it('does not invent provenance before any usage is recorded', () => {
		expect(cost_model([]).cost_text).toBeUndefined();
		expect(cost_model([], true).cost_text).toBe('$0.000 (sub)');
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
		expect(model.cost_text).toBe('$0.203 (est)');
		expect(model.model_text).toContain('claude-sonnet');
		expect(model.preset_status).toBe('prompt:terse');
		expect(model.statuses.get('mcp')).toBe('MCP 6/6 connected');
		expect(model.statuses.has('preset')).toBe(false);
	});
});
