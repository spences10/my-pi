import { describe, expect, it } from 'vitest';
import { normalize_footer_state } from './config.js';
import {
	DEFAULT_FOOTER_STATUS_LAYOUT,
	type FooterState,
} from './presets/types.js';

describe('normalize_footer_state', () => {
	it('merges valid custom status placements with defaults', () => {
		const state = normalize_footer_state({
			status_layout: {
				mcp: { row: 3, alignment: 'center', hidden: false },
				custom: { row: 4, alignment: 'left', hidden: true },
			},
		});

		expect(state.status_layout).toMatchObject({
			mcp: { row: 3, alignment: 'center', hidden: false },
			custom: { row: 4, alignment: 'left', hidden: true },
		});
	});

	it('migrates the fixed primary and secondary placement format', () => {
		const state = normalize_footer_state({
			status_layout: {
				mcp: 'primary-right',
				custom: 'secondary-left',
			} as never,
		});

		expect(state.status_layout.mcp).toEqual({
			row: 1,
			alignment: 'right',
			hidden: false,
		});
		expect(state.status_layout.custom).toEqual({
			row: 2,
			alignment: 'left',
			hidden: false,
		});
	});

	it('rejects invalid placements without sharing default state', () => {
		const state = normalize_footer_state({
			status_layout: {
				mcp: { row: 0, alignment: 'somewhere', hidden: false },
			} as never,
		} as Partial<FooterState>);

		expect(state.status_layout.mcp).toEqual({
			row: 2,
			alignment: 'left',
			hidden: false,
		});
		state.status_layout.mcp.hidden = true;
		expect(DEFAULT_FOOTER_STATUS_LAYOUT.mcp.hidden).toBe(false);
	});
});
