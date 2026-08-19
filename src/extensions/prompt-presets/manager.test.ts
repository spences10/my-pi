import { describe, expect, it, vi } from 'vitest';
import type { ModalTheme } from '@spences10/pi-tui-modal';
import {
	PromptPresetInspectorBody,
	type PromptPresetManagerState,
} from './manager.js';
import type { LoadedPromptPreset } from './types.js';

function preset(
	name: string,
	kind: LoadedPromptPreset['kind'],
	description = `${name} description`,
): LoadedPromptPreset {
	return {
		name,
		kind,
		description,
		instructions: `${name} instructions`,
		source: 'builtin',
	};
}

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as ModalTheme;

function render(state: PromptPresetManagerState): string {
	return new PromptPresetInspectorBody(
		state,
		theme,
		() => 14,
		vi.fn(),
	)
		.render(100)
		.join('\n');
}

describe('prompt preset manager', () => {
	it('opens on the active base preset', () => {
		const output = render({
			presets: {
				alpha: preset('alpha', 'base'),
				beta: preset('beta', 'base'),
				layer: preset('layer', 'layer'),
			},
			active_base_name: 'beta',
			active_layers: new Set(['layer']),
		});

		expect(output).toContain('› ● beta');
		expect(output).toContain('beta description');
		expect(output).toContain('beta instructions');
	});

	it('opens on an active layer when there is no base preset', () => {
		const output = render({
			presets: {
				alpha: preset('alpha', 'base'),
				layer: preset('layer', 'layer'),
			},
			active_base_name: undefined,
			active_layers: new Set(['layer']),
		});

		expect(output).toContain('› ☑ layer');
	});

	it('shows useful preset text without implementation metadata', () => {
		const output = render({
			presets: { alpha: preset('alpha', 'base') },
			active_base_name: 'alpha',
			active_layers: new Set(),
		});

		expect(output).toContain('alpha description');
		expect(output).toContain('alpha instructions');
		expect(output).not.toContain('Kind:');
		expect(output).not.toContain('Source:');
	});
});
