import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import {
	context_chunk_schema,
	list_row_schema,
	search_row_schema,
} from './row-schemas.js';

describe('context database row validation', () => {
	it('accepts nullable chunk titles without trusting invalid ordinals', () => {
		const row = {
			id: 'chunk',
			source_id: 'source',
			ordinal: 0,
			title: null,
			content: 'text',
			byte_count: 4,
		};

		expect(v.parse(context_chunk_schema, row)).toEqual(row);
		expect(
			v.safeParse(context_chunk_schema, { ...row, ordinal: '0' })
				.success,
		).toBe(false);
	});

	it('checks the list projection including optional scope and preview data', () => {
		const row = {
			source_id: 'source',
			created_at: 1,
			project_path: null,
			session_id: null,
			tool_name: 'read',
			input_summary: null,
			byte_count: 4,
			line_count: 1,
			chunk_count: 1,
			first_chunk_title: null,
			preview: null,
		};

		expect(v.parse(list_row_schema, row)).toEqual(row);
		expect(
			v.safeParse(list_row_schema, { ...row, chunk_count: null })
				.success,
		).toBe(false);
	});

	it('checks search projections before mapping them into results', () => {
		const row = {
			id: 'source',
			tool_name: 'read',
			created_at: 1,
			byte_count: 4,
			line_count: 1,
			chunk_id: 'chunk',
			ordinal: 0,
			title: null,
			content: 'text',
			rank: -1,
		};

		expect(v.parse(search_row_schema, row)).toEqual(row);
		expect(
			v.safeParse(search_row_schema, { ...row, content: null })
				.success,
		).toBe(false);
	});
});
