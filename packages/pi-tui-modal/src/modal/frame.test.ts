import { describe, expect, it } from 'vitest';
import {
	pad_to_width,
	render_border_line,
	render_bottom_border_line,
	render_framed_modal,
} from './frame.js';
import { border_characters } from './layout.js';
import type { ModalTheme } from './types.js';

const theme: ModalTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const ansi_pattern = new RegExp(
	`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
	'g',
);
const content = {
	render: (width: number) => [`x`.repeat(width + 2), 'ok'],
	invalidate: () => {},
};

describe('modal frame rendering', () => {
	it('pads and renders border lines', () => {
		expect(pad_to_width('x', 3)).toBe('x  ');
		expect(
			render_border_line(
				border_characters.rounded,
				4,
				(text) => text,
			),
		).toBe('╭──╮');
		expect(
			render_border_line(
				border_characters.rounded,
				1,
				(text) => text,
			),
		).toBe('╭');
		expect(
			render_bottom_border_line(
				border_characters.square,
				4,
				(text) => text,
			),
		).toBe('└──┘');
	});

	it('renders rounded, line, and borderless modals', () => {
		expect(
			render_framed_modal(
				content,
				6,
				{ border: 'rounded' },
				theme,
			).map((line) => line.replace(ansi_pattern, '')),
		).toEqual(['╭────╮', '│xxxx│', '│ok  │', '╰────╯']);
		expect(
			render_framed_modal(content, 3, { border: 'line' }, theme),
		).toEqual(['───', 'xxxxx', 'ok', '───']);
		expect(
			render_framed_modal(content, 3, { border: 'none' }, theme),
		).toEqual(['xxxxx', 'ok']);
	});
});
