export interface ContextStoreOptions {
	db_path?: string;
	project_path?: string | null;
	session_id?: string | null;
	max_bytes?: number;
	max_lines?: number;
}

export interface ContextRetentionPolicy {
	retention_days: number | null;
	purge_on_shutdown: boolean;
	max_mb: number | null;
	max_bytes: number | null;
}

export interface ContextCleanupResult {
	deleted: number;
	age_deleted: number;
	size_deleted: number;
	policy: ContextRetentionPolicy;
}

export interface ContextPurgeDetails {
	deleted: number;
	source_id?: string;
	project_path?: string | null;
	session_id?: string | null;
	older_than_days?: number;
}

export interface StoreContextInput {
	text: string;
	tool_name: string;
	input_summary?: string | null;
	session_id?: string | null;
	project_path?: string | null;
	force?: boolean;
}

export interface StoredContextOutput {
	source_id: string;
	bytes: number;
	lines: number;
	preview: string;
	receipt: string;
	chunk_count: number;
	returned_bytes: number;
	project_path: string | null;
	session_id: string | null;
	deduped?: boolean;
}

export interface ContextSearchResult {
	source_id: string;
	chunk_id: string;
	ordinal: number;
	title: string | null;
	content: string;
	tool_name: string;
	created_at: number;
	bytes: number;
	lines: number;
	rank: number;
}

export interface ContextListResult {
	source_id: string;
	created_at: number;
	project_path: string | null;
	session_id: string | null;
	tool_name: string;
	input_summary: string | null;
	bytes: number;
	lines: number;
	chunk_count: number;
	first_chunk_title: string | null;
	preview: string | null;
}

export interface ContextScopeOptions {
	project_path?: string | null;
	session_id?: string | null;
	global?: boolean;
}

export interface ContextStats {
	sources: number;
	chunks: number;
	bytes_stored: number;
	bytes_returned: number;
	bytes_saved: number;
	reduction_pct: number;
	db_bytes: number;
	wal_bytes: number;
	total_bytes: number;
	oldest_created_at: number | null;
	newest_created_at: number | null;
	retention_days: number | null;
	purge_on_shutdown: boolean;
	max_mb: number | null;
	scope_project_path: string | null;
	scope_session_id: string | null;
	global_sources: number;
	global_chunks: number;
	global_bytes_stored: number;
	global_oldest_created_at: number | null;
	global_newest_created_at: number | null;
}

export interface SourceRow {
	id: string;
	tool_name: string;
	created_at: number;
	byte_count: number;
	line_count: number;
}

export interface SearchRow extends SourceRow {
	chunk_id: string;
	ordinal: number;
	title: string | null;
	content: string;
	rank: number;
}

export interface ScopedFilter {
	where: string[];
	params: Array<string | number>;
}

export interface ListRow {
	source_id: string;
	created_at: number;
	project_path: string | null;
	session_id: string | null;
	tool_name: string;
	input_summary: string | null;
	byte_count: number;
	line_count: number;
	chunk_count: number;
	first_chunk_title: string | null;
	preview: string | null;
}

export interface ContextChunk {
	id: string;
	source_id: string;
	ordinal: number;
	title: string | null;
	content: string;
	byte_count: number;
}
