import { describe, expect, it } from 'vite-plus/test';
import { make_context } from '../test-utils.js';
import {
	get_current_thinking_level,
	get_default_footer_thinking_level,
} from './thinking.js';

describe('thinking footer model helpers', () => {
	it('returns off for non-reasoning models', () => {
		expect(
			get_default_footer_thinking_level({
				reasoning: false,
			} as never),
		).toBe('off');
	});

	it('reads the latest thinking level change', () => {
		const ctx = make_context({
			sessionManager: {
				getEntries: () => [
					{ type: 'thinking_level_change', thinkingLevel: 'low' },
					{ type: 'thinking_level_change', thinkingLevel: 'high' },
				],
			},
		});
		expect(get_current_thinking_level(ctx)).toBe('high');
	});

	it('forces off when current model does not support reasoning', () => {
		const ctx = make_context({
			model: { reasoning: false },
			sessionManager: {
				getEntries: () => [
					{ type: 'thinking_level_change', thinkingLevel: 'high' },
				],
			},
		});
		expect(get_current_thinking_level(ctx)).toBe('off');
	});
});
