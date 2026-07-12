import { describe, expect, it } from 'vitest';
import { test_theme } from '../test-utils.js';
import type { FooterTheme } from '../theme/tokens.js';
import {
	render_footer_status_line,
	render_footer_three_column_line,
} from './status-line.js';

const plain_theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as FooterTheme;

describe('render_footer_status_line', () => {
	it('renders left-only status using the selected tone', () => {
		expect(
			render_footer_status_line(
				test_theme,
				80,
				['MCP 6/6 connected'],
				undefined,
				'bright',
			),
		).toContain('<accent>MCP 6/6 connected</accent>');
	});

	it('aligns right-only status to the right', () => {
		const line = render_footer_status_line(
			test_theme,
			30,
			[],
			'prompt:terse',
		);
		expect(line).toContain('prompt:terse');
		expect(line?.startsWith(' ')).toBe(true);
	});

	it('anchors center content while preserving left and right zones', () => {
		const line = render_footer_three_column_line(
			plain_theme,
			30,
			['left'],
			['middle'],
			['right'],
		);

		expect(line?.indexOf('middle')).toBe(12);
		expect(line?.startsWith('left')).toBe(true);
		expect(line?.endsWith('right')).toBe(true);
		expect(line?.length).toBeLessThanOrEqual(30);
	});

	it('returns undefined when no status text exists', () => {
		expect(
			render_footer_status_line(test_theme, 30, []),
		).toBeUndefined();
	});
});
