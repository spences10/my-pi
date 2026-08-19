import type { ModalTheme } from '@spences10/pi-tui-modal';
import { describe, expect, it, vi } from 'vitest';
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
		origin: 'builtin',
		path: null,
		editable: false,
		fallbacks: [],
	};
}

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as ModalTheme;

function body(
	state: PromptPresetManagerState,
	done = vi.fn(),
	lines = 14,
) {
	return new PromptPresetInspectorBody(
		state,
		theme,
		() => lines,
		done,
	);
}

function render(
	state: PromptPresetManagerState,
	width = 100,
): string {
	return body(state).render(width).join('\n');
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

	it('keeps every management action visible in narrow terminals', () => {
		const output = render(
			{
				presets: { alpha: preset('alpha', 'base') },
				active_base_name: 'alpha',
				active_layers: new Set(),
			},
			56,
		);

		for (const label of [
			'Create',
			'Edit',
			'Copy',
			'Rename',
			'Delete',
			'Reset',
			'Reload',
		]) {
			expect(output).toContain(label);
		}
	});

	it.each([
		['n', 'create'],
		['e', 'edit'],
		['y', 'copy'],
		['r', 'rename'],
		['d', 'delete'],
		['x', 'reset'],
		['l', 'reload'],
	] as const)('exposes %s as the %s action', (key, action) => {
		const done = vi.fn();
		const component = body(
			{
				presets: { alpha: preset('alpha', 'base') },
				active_base_name: 'alpha',
				active_layers: new Set(),
			},
			done,
		);
		component.handleInput(key);
		expect(done).toHaveBeenCalledWith(
			action === 'create' || action === 'reload'
				? { action }
				: {
						action,
						preset: expect.objectContaining({ name: 'alpha' }),
					},
		);
	});

	it('keeps selection changes as a draft until Apply and supports Cancel', () => {
		const state = {
			presets: { alpha: preset('alpha', 'base') },
			active_base_name: undefined,
			active_layers: new Set<string>(),
		};
		const applied = vi.fn();
		const component = body(state, applied);
		component.handleInput('\u001b[B');
		component.handleInput(' ');
		expect(state.active_base_name).toBeUndefined();
		component.handleInput('a');
		expect(applied).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'apply',
				base_name: 'alpha',
			}),
		);

		const cancelled = vi.fn();
		body(state, cancelled).handleInput('\u001b');
		expect(cancelled).toHaveBeenCalledWith({ action: 'cancel' });
	});
});
