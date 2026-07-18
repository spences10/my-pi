import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
	resolve_effective_thinking_level,
	resolve_model_reference,
} from './models.js';

function model(overrides: Record<string, unknown> = {}) {
	return {
		id: 'test-model',
		name: 'Test Model',
		api: 'openai-completions',
		provider: 'test',
		baseUrl: 'http://localhost/v1',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
		...overrides,
	} as Model<Api>;
}

describe('api model helpers', () => {
	it('resolves bare ids, provider/id refs, and case-insensitive providers', () => {
		const anthropic = model({
			provider: 'anthropic',
			id: 'claude-sonnet',
		});
		const openrouter = model({
			provider: 'openrouter',
			id: 'openai/gpt-4o',
		});
		const registry = { getModels: () => [anthropic, openrouter] };

		expect(resolve_model_reference('claude-sonnet', registry)).toBe(
			anthropic,
		);
		expect(
			resolve_model_reference('ANTHROPIC/CLAUDE-SONNET', registry),
		).toBe(anthropic);
		expect(resolve_model_reference('openai/gpt-4o', registry)).toBe(
			openrouter,
		);
		expect(
			resolve_model_reference('missing', registry),
		).toBeUndefined();
	});

	it('clamps thinking only when a model is present', () => {
		const high_only = model({
			thinkingLevelMap: {
				minimal: null,
				low: null,
				medium: null,
				high: 'high',
				xhigh: null,
			},
		});

		expect(
			resolve_effective_thinking_level(high_only, 'medium'),
		).toBe('high');
		expect(resolve_effective_thinking_level(undefined, 'xhigh')).toBe(
			'xhigh',
		);
	});
});
