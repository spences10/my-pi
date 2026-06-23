import { describe, expect, it } from 'vitest';

import {
	DEFAULT_FUSION_ANALYSIS_MODELS,
	DEFAULT_FUSION_JUDGE_MODEL,
	apply_fusion_config_plugin,
	get_fusion_plugin_config,
	get_fusion_request_config,
} from './index.js';

describe('openrouter-fusion-config', () => {
	it('injects a non-Anthropic fusion plugin for openrouter/fusion', () => {
		const result = apply_fusion_config_plugin(
			{
				model: 'openrouter/fusion',
				messages: [],
			},
			get_fusion_request_config({ env: {}, settings: {} }),
		);

		expect(result).toMatchObject({
			model: 'openrouter/fusion',
			plugins: [
				{
					id: 'fusion',
					analysis_models: [...DEFAULT_FUSION_ANALYSIS_MODELS],
					model: DEFAULT_FUSION_JUDGE_MODEL,
				},
			],
		});
		expect(JSON.stringify(result)).not.toContain('anthropic');
	});

	it('replaces an existing fusion plugin without touching other plugins', () => {
		const result = apply_fusion_config_plugin(
			{
				model: 'openrouter/fusion',
				plugins: [
					{ id: 'other' },
					{
						id: 'fusion',
						analysis_models: ['~anthropic/claude-opus-latest'],
					},
				],
			},
			get_fusion_request_config({ env: {}, settings: {} }),
		);

		expect((result as { plugins: unknown[] }).plugins).toEqual([
			{ id: 'other' },
			{
				id: 'fusion',
				analysis_models: [...DEFAULT_FUSION_ANALYSIS_MODELS],
				model: DEFAULT_FUSION_JUDGE_MODEL,
			},
		]);
	});

	it('ignores non-fusion requests', () => {
		expect(
			apply_fusion_config_plugin(
				{ model: 'openai/gpt-4.1' },
				get_fusion_request_config({ env: {}, settings: {} }),
			),
		).toBeUndefined();
	});

	it('allows my-pi settings overrides for panel and judge', () => {
		expect(
			get_fusion_plugin_config({
				env: {},
				settings: {
					analysisModels: [
						'deepseek/deepseek-v3.2',
						'google/gemini-2.5-pro',
					],
					judgeModel: 'google/gemini-2.5-pro',
				},
			}),
		).toEqual({
			id: 'fusion',
			analysis_models: [
				'deepseek/deepseek-v3.2',
				'google/gemini-2.5-pro',
			],
			model: 'google/gemini-2.5-pro',
		});
	});

	it('allows env overrides for panel and judge', () => {
		expect(
			get_fusion_plugin_config({
				env: {
					MY_PI_FUSION_ANALYSIS_MODELS:
						'deepseek/deepseek-v3.2, google/gemini-2.5-pro',
					MY_PI_FUSION_JUDGE_MODEL: 'google/gemini-2.5-pro',
				},
				settings: {
					analysisModels: ['ignored/model'],
					judgeModel: 'ignored/judge',
				},
			}),
		).toEqual({
			id: 'fusion',
			analysis_models: [
				'deepseek/deepseek-v3.2',
				'google/gemini-2.5-pro',
			],
			model: 'google/gemini-2.5-pro',
		});
	});

	it('forces fusion invocation by default', () => {
		const result = apply_fusion_config_plugin(
			{ model: 'openrouter/fusion' },
			get_fusion_request_config({ env: {}, settings: {} }),
		);

		expect(result).toMatchObject({ tool_choice: 'required' });
	});

	it('allows force opt-out', () => {
		const result = apply_fusion_config_plugin(
			{ model: 'openrouter/fusion' },
			get_fusion_request_config({
				env: {},
				settings: { force: false },
			}),
		);

		expect(result).not.toMatchObject({ tool_choice: 'required' });
	});
});
