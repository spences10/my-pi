import { describe, expect, it, vi } from 'vitest';
import { DetailedSettingsList, TextModalBody } from './bodies.js';
import type { ModalTheme } from './types.js';

const modal_theme: ModalTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const settings_theme = {
	cursor: '→ ',
	label: (text: string) => text,
	value: (text: string) => text,
	description: (text: string) => text,
	hint: (text: string) => text,
};

describe('modal bodies', () => {
	it('renders scrollable text and invokes cancel', () => {
		const cancel = vi.fn();
		const body = new TextModalBody(
			'one\ntwo\nthree',
			2,
			modal_theme,
			cancel,
		);

		expect(body.render(20)).toEqual(['one', 'two', '(1-2/3)']);
		body.handleInput('j');
		expect(body.render(20)).toEqual(['two', 'three', '(2-3/3)']);
		body.handleInput('q');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('expands tabs before wrapping text modal content', () => {
		const body = new TextModalBody(
			'Took 0.0s\tlong_identifier',
			5,
			modal_theme,
			vi.fn(),
		);

		expect(body.render(12)).toEqual([
			'Took 0.0s',
			'long_identif',
			'ier',
		]);
	});

	it('renders settings, cycles values, filters, and cancels', () => {
		const on_change = vi.fn();
		const on_cancel = vi.fn();
		const body = new DetailedSettingsList(
			[
				{
					id: 'theme',
					label: 'Theme',
					currentValue: 'light',
					values: ['light', 'dark'],
					description: 'Color mode',
				},
				{
					id: 'sound',
					label: 'Sound',
					currentValue: 'off',
					values: ['off', 'on'],
				},
			],
			2,
			settings_theme,
			on_change,
			on_cancel,
			{ enable_search: true, detail: (item) => `id:${item.id}` },
		);

		const rendered = body.render(80).join('\n');
		expect(rendered).toContain('Theme');
		expect(rendered).toContain('id:theme');

		body.handleInput(' ');
		expect(on_change).toHaveBeenLastCalledWith('theme', 'dark');
		body.handleInput('\u001b[D');
		expect(on_change).toHaveBeenLastCalledWith('theme', 'light');
		body.handleInput('\u001b[C');
		expect(on_change).toHaveBeenLastCalledWith('theme', 'dark');

		body.handleInput('sound');
		expect(body.get_selected_item()?.id).toBe('sound');
		const change_count = on_change.mock.calls.length;
		body.handleInput('\u001b[D');
		expect(on_change).toHaveBeenCalledTimes(change_count);

		body.handleInput('\u001b');
		expect(on_cancel).toHaveBeenCalledOnce();
	});
});
