import { Type } from 'typebox';

const nullable_string = Type.Union([Type.String(), Type.Null()]);
const nullable_number = Type.Union([Type.Number(), Type.Null()]);

export const context_chunk_schema = Type.Object({
	id: Type.String(),
	source_id: Type.String(),
	ordinal: Type.Number(),
	title: nullable_string,
	content: Type.String(),
	byte_count: Type.Number(),
});

export const context_search_output_schema = Type.Object({
	results: Type.Array(
		Type.Object({
			source_id: Type.String(),
			chunk_id: Type.String(),
			ordinal: Type.Number(),
			title: nullable_string,
			content: Type.String(),
			tool_name: Type.String(),
			created_at: Type.Number(),
			bytes: Type.Number(),
			lines: Type.Number(),
			rank: Type.Number(),
			snippet: Type.Boolean(),
		}),
	),
});

export const context_get_output_schema = Type.Object({
	chunks: Type.Array(context_chunk_schema),
	message: Type.String(),
});

export const context_export_output_schema = Type.Object({
	count: Type.Number(),
	exported: Type.Boolean(),
	file_path: nullable_string,
	bytes: Type.Number(),
	verified: Type.Union([Type.Boolean(), Type.Null()]),
	message: Type.String(),
});

export const context_list_output_schema = Type.Object({
	sources: Type.Array(
		Type.Object({
			source_id: Type.String(),
			created_at: Type.Number(),
			project_path: nullable_string,
			session_id: nullable_string,
			tool_name: Type.String(),
			input_summary: nullable_string,
			bytes: Type.Number(),
			lines: Type.Number(),
			chunk_count: Type.Number(),
			first_chunk_title: nullable_string,
			preview: nullable_string,
		}),
	),
});

export const context_stats_output_schema = Type.Object({
	sources: Type.Number(),
	chunks: Type.Number(),
	bytes_stored: Type.Number(),
	bytes_returned: Type.Number(),
	bytes_saved: Type.Number(),
	reduction_pct: Type.Number(),
	db_bytes: Type.Number(),
	wal_bytes: Type.Number(),
	total_bytes: Type.Number(),
	oldest_created_at: nullable_number,
	newest_created_at: nullable_number,
	retention_days: nullable_number,
	purge_on_shutdown: Type.Boolean(),
	max_mb: nullable_number,
	scope_project_path: nullable_string,
	scope_session_id: nullable_string,
	global_sources: Type.Number(),
	global_chunks: Type.Number(),
	global_bytes_stored: Type.Number(),
	global_oldest_created_at: nullable_number,
	global_newest_created_at: nullable_number,
});

export const context_purge_output_schema = Type.Object({
	deleted: Type.Number(),
	source_id: Type.Optional(Type.String()),
	project_path: Type.Optional(nullable_string),
	session_id: Type.Optional(nullable_string),
	older_than_days: Type.Optional(Type.Number()),
});

export const context_tool_namespace = {
	name: 'context',
	description:
		'Search and retrieve oversized tool output from the local SQLite sidecar.',
	instructions:
		'Prefer codemode filtering before returning large results. For captured output, search snippets, retrieve focused chunks, or export to a file for broad processing. Maintenance tools context_stats and context_purge are discoverable with searchTools().',
};
