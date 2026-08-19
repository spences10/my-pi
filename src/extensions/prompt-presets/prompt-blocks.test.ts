import { describe, expect, it } from 'vitest';
import { build_active_prompt_blocks } from './prompt-blocks.js';
import type { LoadedPromptPreset } from './types.js';

function preset(
	name: string,
	kind: LoadedPromptPreset['kind'],
	instructions: string,
): LoadedPromptPreset {
	return {
		name,
		kind,
		instructions,
		source: 'builtin',
		origin: 'builtin',
		path: null,
		editable: false,
		fallbacks: [],
	};
}

describe('build_active_prompt_blocks', () => {
	it('builds base and sorted layer prompt blocks', () => {
		const blocks = build_active_prompt_blocks(
			{
				base: preset('base', 'base', 'base instructions'),
				z: preset('z', 'layer', 'z layer'),
				a: preset('a', 'layer', 'a layer'),
			},
			'base',
			new Set(['z', 'a']),
		);

		expect(blocks).toEqual([
			'## Active Base Prompt: base\nbase instructions',
			'## Active Prompt Layers\n\n### a\na layer\n\n### z\nz layer',
		]);
	});

	it('omits missing and blank presets', () => {
		expect(
			build_active_prompt_blocks(
				{ blank: preset('blank', 'base', '   ') },
				'blank',
				new Set(['missing']),
			),
		).toEqual([]);
	});
});
