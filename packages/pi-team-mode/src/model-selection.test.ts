import { describe, expect, it } from 'vitest';
import { select_teammate_model_config } from './model-selection.js';

function model(provider: string, id: string, thinkingLevelMap = {}) {
	return { provider, id, reasoning: true, thinkingLevelMap } as any;
}

const registry = {
	getAll: () => [
		model('anthropic', 'claude-sonnet-4-5', {
			minimal: null,
			low: null,
			medium: null,
			high: 'high',
			xhigh: null,
		}),
		model('openrouter', 'anthropic/claude-sonnet-4.5'),
	],
};

describe('select_teammate_model_config', () => {
	it('resolves explicit provider/model references before spawning', () => {
		expect(
			select_teammate_model_config({
				requested_model: 'openrouter/anthropic/claude-sonnet-4.5',
				model_registry: registry,
			}),
		).toMatchObject({
			model: 'openrouter/anthropic/claude-sonnet-4.5',
		});
	});

	it('fails loudly when an explicit model is unavailable', () => {
		expect(() =>
			select_teammate_model_config({
				requested_model: 'missing/model',
				model_registry: registry,
			}),
		).toThrow('Model is not available: missing/model');
	});

	it('falls back to the current model and clamps thinking to supported levels', () => {
		expect(
			select_teammate_model_config({
				current_model: registry.getAll()[0],
				requested_thinking: 'xhigh',
			}),
		).toEqual({
			model: 'anthropic/claude-sonnet-4-5',
			thinking: 'high',
		});
	});
});
