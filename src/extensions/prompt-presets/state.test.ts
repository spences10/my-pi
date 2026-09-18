import { describe, expect, it } from 'vite-plus/test';
import {
	normalize_active_state,
	parse_preset_flag,
	sets_equal,
} from './state.js';
import type { LoadedPromptPreset } from './types.js';

describe('src/extensions/prompt-presets/state.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./state.js')).resolves.toBeDefined();
	});

	it('compares sets by value', () => {
		expect(sets_equal(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(
			true,
		);
		expect(sets_equal(new Set(['a']), new Set(['b']))).toBe(false);
	});

	it('parses comma-separated preset flags', () => {
		expect(parse_preset_flag(' terse, bullets ,,')).toEqual([
			'terse',
			'bullets',
		]);
	});

	it('drops unavailable active base and layer names', () => {
		const presets = {
			terse: { name: 'terse', kind: 'base' },
			bullets: { name: 'bullets', kind: 'layer' },
		} as unknown as Record<string, LoadedPromptPreset>;

		expect(
			normalize_active_state(
				presets,
				'missing',
				new Set(['bullets', 'missing-layer']),
			),
		).toEqual({
			active_base_name: undefined,
			active_layers: new Set(['bullets']),
		});
	});
});
