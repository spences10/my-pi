import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TEAM_LIST_LIMIT,
	format_team_page,
	MAX_TEAM_LIST_LIMIT,
	paginate_team_items,
} from './pagination.js';

describe('Team Mode pagination', () => {
	it('bounds default output and reports the next offset', () => {
		const page = paginate_team_items(
			Array.from({ length: 250 }, (_, index) => index),
		);

		expect(page.items).toHaveLength(DEFAULT_TEAM_LIST_LIMIT);
		expect(page.pagination).toEqual({
			returned_count: DEFAULT_TEAM_LIST_LIMIT,
			total_count: 250,
			has_more: true,
			limit: DEFAULT_TEAM_LIST_LIMIT,
			offset: 0,
			next_offset: DEFAULT_TEAM_LIST_LIMIT,
		});
	});

	it('supports explicit limit and offset pages', () => {
		const page = paginate_team_items(['a', 'b', 'c', 'd'], {
			limit: 2,
			offset: 2,
		});

		expect(page.items).toEqual(['c', 'd']);
		expect(page.pagination).toMatchObject({
			returned_count: 2,
			total_count: 4,
			has_more: false,
			limit: 2,
			offset: 2,
		});
	});

	it('rejects invalid or unbounded pages', () => {
		expect(() => paginate_team_items([], { limit: 0 })).toThrow(
			/limit/,
		);
		expect(() =>
			paginate_team_items([], { limit: MAX_TEAM_LIST_LIMIT + 1 }),
		).toThrow(/limit/);
		expect(() => paginate_team_items([], { offset: -1 })).toThrow(
			/offset/,
		);
	});

	it('formats machine-readable counts and next-page guidance', () => {
		const text = format_team_page(
			'session_list',
			'- session-a',
			paginate_team_items([1, 2, 3], { limit: 1 }).pagination,
			{ warning: 'broad detail is paginated' },
		);

		expect(text).toContain('Warning: broad detail is paginated');
		expect(text).toContain(
			'returned_count=1 total_count=3 has_more=true limit=1 offset=0',
		);
		expect(text).toContain(
			'action=session_list with limit=1 offset=1',
		);
	});
});
