import { describe, expect, it } from 'vitest';
import {
	count_text_lines,
	cycle_setting_value,
	fit_visible_items,
	get_border_line_count,
	get_modal_body_line_budget,
	get_vertical_margin,
	normalize_metadata,
	normalize_text,
	parse_size_value,
	value_color,
} from './layout.js';

const tui = { terminal: { rows: 30 } };

describe('modal layout helpers', () => {
	it('normalizes static, dynamic, and missing text', () => {
		expect(normalize_text(undefined)).toEqual([]);
		expect(normalize_text('hello')).toEqual(['hello']);
		expect(normalize_text(() => ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('parses percentages and ignores invalid sizes', () => {
		expect(parse_size_value('50%', 40)).toBe(20);
		expect(parse_size_value('12.5%', 80)).toBe(10);
		expect(parse_size_value(12, 40)).toBe(12);
		expect(parse_size_value('large', 40)).toBeUndefined();
	});

	it('computes body line budget from terminal, chrome, and margins', () => {
		expect(
			get_modal_body_line_budget(
				tui,
				{
					title: 'Title',
					subtitle: 'Subtitle',
					footer: 'Footer',
					overlay_options: {
						maxHeight: '50%',
						margin: { top: 2, bottom: 3 },
					},
				},
				80,
			),
		).toBe(8);
	});

	it('clamps visible item counts for scroll indicators', () => {
		expect(fit_visible_items(20, 10, 5)).toBe(4);
		expect(fit_visible_items(3, 10, 5)).toBe(3);
		expect(fit_visible_items(0, 10, 0)).toBe(1);
	});

	it('cycles setting values in either direction with wrapping', () => {
		const item = {
			id: 'alignment',
			label: 'Alignment',
			currentValue: 'left',
			values: ['left', 'center', 'right'],
		};

		expect(cycle_setting_value(item, -1)).toBe('right');
		expect(cycle_setting_value(item, 1)).toBe('left');
	});

	it('handles margins, borders, text lines, metadata, and value colors', () => {
		expect(get_vertical_margin(2)).toBe(4);
		expect(get_vertical_margin({ top: -1, bottom: 3 })).toBe(3);
		expect(get_border_line_count({ border: 'none' })).toBe(0);
		expect(get_border_line_count({ border: 'rounded' })).toBe(2);
		expect(count_text_lines(() => ['one', '', 'two'], 10)).toBe(2);
		expect(
			normalize_metadata((item) => item?.label, {
				label: 'Label',
			} as Parameters<typeof normalize_metadata>[1]),
		).toEqual(['Label']);
		expect(value_color('✓ enabled')).toBe('success');
		expect(value_color('sync queued')).toBe('warning');
		expect(value_color('other')).toBe('dim');
	});
});
