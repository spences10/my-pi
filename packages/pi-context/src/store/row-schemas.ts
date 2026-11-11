import * as v from 'valibot';
import type { ContextChunk, ListRow, SearchRow } from '../types.js';

export const context_chunk_schema = v.object({
	id: v.string(),
	source_id: v.string(),
	ordinal: v.number(),
	title: v.nullable(v.string()),
	content: v.string(),
	byte_count: v.number(),
}) satisfies v.GenericSchema<ContextChunk>;

export const list_row_schema = v.object({
	source_id: v.string(),
	created_at: v.number(),
	project_path: v.nullable(v.string()),
	session_id: v.nullable(v.string()),
	tool_name: v.string(),
	input_summary: v.nullable(v.string()),
	byte_count: v.number(),
	line_count: v.number(),
	chunk_count: v.number(),
	first_chunk_title: v.nullable(v.string()),
	preview: v.nullable(v.string()),
}) satisfies v.GenericSchema<ListRow>;

export const search_row_schema = v.object({
	id: v.string(),
	tool_name: v.string(),
	created_at: v.number(),
	byte_count: v.number(),
	line_count: v.number(),
	chunk_id: v.string(),
	ordinal: v.number(),
	title: v.nullable(v.string()),
	content: v.string(),
	rank: v.number(),
}) satisfies v.GenericSchema<SearchRow>;
