import { describe, expect, it } from 'vite-plus/test';
import { make_context } from '../test-utils.js';
import { make_model } from '../../../../tools/test-sdk.js';
import { make_thinking_entries } from './test-fixtures.js';
import {
	get_current_thinking_level,
	get_default_footer_thinking_level,
} from './thinking.js';

describe('thinking footer model helpers', () => {
	it('returns off for non-reasoning models', () => {
		expect(
			get_default_footer_thinking_level(
				make_model({ reasoning: false }),
			),
		).toBe('off');
	});

	it('reads the latest thinking level change', () => {
		const ctx = make_context({
			sessionManager: {
				getEntries: () => make_thinking_entries('low', 'high'),
			},
		});

		expect(get_current_thinking_level(ctx)).toBe('high');
	});

	it('forces off when current model does not support reasoning', () => {
		const ctx = make_context({
			model: make_model({ reasoning: false }),
			sessionManager: {
				getEntries: () => make_thinking_entries('high'),
			},
		});

		expect(get_current_thinking_level(ctx)).toBe('off');
	});
});
