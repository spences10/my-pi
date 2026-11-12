import * as v from 'valibot';
import type {
	ChunkSummaryRow,
	ContextChunk,
	ListRow,
	SearchRow,
} from '../types.js';

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

export const chunk_summary_row_schema = v.object({
	source_id: v.string(),
	chunk_count: v.number(),
	first_chunk_id: v.nullable(v.string()),
	last_chunk_id: v.nullable(v.string()),
	first_ordinal: v.nullable(v.number()),
	last_ordinal: v.nullable(v.number()),
}) satisfies v.GenericSchema<ChunkSummaryRow>;

export const chunk_ordinal_row_schema = v.object({
	ordinal: v.number(),
});

export const duplicate_source_row_schema = v.object({
	id: v.string(),
	chunk_count: v.number(),
	first_chunk_id: v.nullable(v.string()),
});

export const content_hash_row_schema = v.object({
	content_hash: v.string(),
});

export const user_version_row_schema = v.object({
	user_version: v.number(),
});

export const source_stats_row_schema = v.object({
	sources: v.number(),
	bytes_stored: v.number(),
	bytes_returned: v.number(),
	oldest_created_at: v.nullable(v.number()),
	newest_created_at: v.nullable(v.number()),
});

export const chunk_count_row_schema = v.object({
	chunks: v.number(),
});

export const stored_bytes_row_schema = v.object({
	bytes: v.number(),
});

export const source_size_row_schema = v.object({
	id: v.string(),
	byte_count: v.number(),
});
