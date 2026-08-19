import { describe, expect, it } from 'vitest';
import { get_prompt_preset_completions } from './completions.js';
import type { LoadedPromptPreset } from './types.js';

function preset(
	name: string,
	kind: LoadedPromptPreset['kind'],
): LoadedPromptPreset {
	return {
		name,
		kind,
		instructions: name,
		source: 'builtin',
		origin: 'builtin',
		path: null,
		editable: false,
		fallbacks: [],
	};
}

describe('get_prompt_preset_completions', () => {
	const presets = {
		terse: preset('terse', 'base'),
		polish: preset('polish', 'layer'),
	};

	it('completes subcommands and preset names at the root', () => {
		expect(
			get_prompt_preset_completions(presets, 't')?.map(
				(item) => item.value,
			),
		).toContain('terse');
		expect(
			get_prompt_preset_completions(presets, 'to')?.map(
				(item) => item.value,
			),
		).toContain('toggle');
	});

	it('completes base and layer subcommands with scoped names', () => {
		expect(get_prompt_preset_completions(presets, 'base t')).toEqual([
			{ value: 'base terse', label: 'terse' },
		]);
		expect(
			get_prompt_preset_completions(presets, 'enable p'),
		).toEqual([{ value: 'enable polish', label: 'polish' }]);
	});
});
