import { redact_text } from '@spences10/pi-redact';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse_context_retention_policy } from './policy.js';
import { apply_schema } from './schema.js';
import {
	DEFAULT_CONTEXT_MAX_BYTES,
	DEFAULT_CONTEXT_MAX_LINES,
	chunk_text,
	count_lines,
	escape_fts5_query,
	make_preview,
	should_index_text,
	summarize_source,
} from './text.js';
import type {
	ContextChunk,
	ContextCleanupResult,
	ContextListResult,
	ContextPurgeDetails,
	ContextRetentionPolicy,
	ContextScopeOptions,
	ContextSearchResult,
	ContextStats,
	ContextStoreOptions,
	ListRow,
	ScopedFilter,
	SearchRow,
	StoreContextInput,
	StoredContextOutput,
} from './types.js';

export {
	DEFAULT_CONTEXT_RETENTION_DAYS,
	parse_context_retention_policy,
} from './policy.js';
export {
	DEFAULT_CONTEXT_MAX_BYTES,
	DEFAULT_CONTEXT_MAX_LINES,
	count_lines,
	escape_fts5_query,
	make_preview,
	should_index_text,
} from './text.js';
export type {
	ContextChunk,
	ContextCleanupResult,
	ContextListResult,
	ContextPurgeDetails,
	ContextRetentionPolicy,
	ContextScopeOptions,
	ContextSearchResult,
	ContextStats,
	ContextStoreOptions,
	StoreContextInput,
	StoredContextOutput,
} from './types.js';

let global_options: ContextStoreOptions = {};
let global_enabled = false;
let global_store: ContextStore | null = null;

export function default_context_db_path(): string {
	if (process.env.MY_PI_CONTEXT_DB)
		return process.env.MY_PI_CONTEXT_DB;
	const agent_dir =
		process.env.PI_CODING_AGENT_DIR ??
		join(
			process.env.HOME ?? process.env.USERPROFILE ?? homedir(),
			'.pi',
			'agent',
		);
	return join(agent_dir, 'context.db');
}

export function set_context_sidecar_enabled(
	enabled: boolean,
	options: ContextStoreOptions = {},
): void {
	global_enabled = enabled;
	if (!enabled) {
		global_options = {};
		global_store = null;
		return;
	}
	global_options = { ...global_options, ...options };
}

export function is_context_sidecar_enabled(): boolean {
	return global_enabled;
}

export function get_context_store(
	options: ContextStoreOptions = {},
): ContextStore {
	const merged = { ...global_options, ...options };
	const db_path = merged.db_path ?? default_context_db_path();
	if (!global_store || global_store.db_path !== db_path) {
		global_store = new ContextStore({ ...merged, db_path });
	} else {
		global_store.configure(merged);
	}
	return global_store;
}

export function maybe_store_context_output(
	input: StoreContextInput,
	options: ContextStoreOptions = {},
): StoredContextOutput | null {
	if (!global_enabled) return null;
	return get_context_store(options).store(input);
}

export class ContextStore {
	readonly db_path: string;
	private db: DatabaseSync;
	private project_path: string | null;
	private session_id: string | null;
	private max_bytes: number;
	private max_lines: number;

	constructor(options: ContextStoreOptions = {}) {
		this.db_path = options.db_path ?? default_context_db_path();
		this.project_path = options.project_path ?? process.cwd();
		this.session_id = options.session_id ?? null;
		this.max_bytes = options.max_bytes ?? DEFAULT_CONTEXT_MAX_BYTES;
		this.max_lines = options.max_lines ?? DEFAULT_CONTEXT_MAX_LINES;

		const dir = dirname(this.db_path);
		if (!existsSync(dir))
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(this.db_path, {
			enableForeignKeyConstraints: true,
		});
		apply_schema(this.db);
	}

	configure(options: ContextStoreOptions = {}): void {
		if (options.project_path !== undefined)
			this.project_path = options.project_path;
		if (options.session_id !== undefined)
			this.session_id = options.session_id;
		if (options.max_bytes !== undefined)
			this.max_bytes = options.max_bytes;
		if (options.max_lines !== undefined)
			this.max_lines = options.max_lines;
	}

	private scoped_filter(
		alias: string,
		options: ContextScopeOptions = {},
	): ScopedFilter {
		const where: string[] = [];
		const params: Array<string | number> = [];
		if (options.session_id === null) {
			where.push(`${alias}.session_id IS NULL`);
		} else if (options.session_id !== undefined) {
			where.push(`${alias}.session_id = ?`);
			params.push(options.session_id);
		} else if (!options.global && this.session_id) {
			where.push(`${alias}.session_id = ?`);
			params.push(this.session_id);
		}

		if (options.project_path === null) {
			where.push(`${alias}.project_path IS NULL`);
		} else if (options.project_path !== undefined) {
			where.push(`${alias}.project_path = ?`);
			params.push(options.project_path);
		} else if (
			!options.global &&
			where.length === 0 &&
			this.project_path
		) {
			where.push(`${alias}.project_path = ?`);
			params.push(this.project_path);
		}

		return { where, params };
	}

	private find_duplicate_source(
		content_hash: string,
		scope: ContextScopeOptions,
	): { id: string; chunk_count: number } | null {
		const scoped = this.scoped_filter('context_sources', scope);
		const filters = [
			'context_sources.content_hash = ?',
			...scoped.where,
		];
		const params: Array<string | number> = [
			content_hash,
			...scoped.params,
		];
		const row = this.db
			.prepare(`
				SELECT context_sources.id, COUNT(context_chunks.id) as chunk_count
				FROM context_sources
				LEFT JOIN context_chunks ON context_chunks.source_id = context_sources.id
				WHERE ${filters.join(' AND ')}
				GROUP BY context_sources.id
				ORDER BY context_sources.created_at DESC
				LIMIT 1
			`)
			.get(...params) as
			| { id: string; chunk_count: number }
			| undefined;
		return row ?? null;
	}

	store(input: StoreContextInput): StoredContextOutput | null {
		const redaction = redact_text(input.text);
		const text = redaction.redacted;
		if (
			!input.force &&
			!should_index_text(text, {
				max_bytes: this.max_bytes,
				max_lines: this.max_lines,
			})
		)
			return null;

		const bytes = Buffer.byteLength(text, 'utf8');
		const lines = count_lines(text);
		const created_at = Date.now();
		const content_hash = createHash('sha256')
			.update(text)
			.digest('hex');
		const session_id = input.session_id ?? this.session_id;
		const project_path = input.project_path ?? this.project_path;
		const preview = make_preview(text);
		const duplicate = this.find_duplicate_source(content_hash, {
			session_id,
			project_path,
		});
		if (duplicate) {
			const provisional: StoredContextOutput = {
				source_id: duplicate.id,
				bytes,
				lines,
				preview,
				receipt: '',
				chunk_count: duplicate.chunk_count,
				returned_bytes: 0,
				deduped: true,
			};
			const receipt = summarize_source(provisional, input.tool_name);
			const returned_bytes = Buffer.byteLength(receipt, 'utf8');
			this.db
				.prepare(
					'UPDATE context_sources SET returned_byte_count = returned_byte_count + ? WHERE id = ?',
				)
				.run(returned_bytes, duplicate.id);
			return { ...provisional, receipt, returned_bytes };
		}
		const source_id = `ctx_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
		const chunks = chunk_text(text, source_id);
		const preview_bytes = Buffer.byteLength(preview, 'utf8');

		const insert = this.db.prepare(`
			INSERT INTO context_sources (
				id, session_id, project_path, tool_name, input_summary, created_at,
				byte_count, line_count, content_hash, preview_byte_count, returned_byte_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
		`);
		const insert_chunk = this.db.prepare(`
			INSERT INTO context_chunks (id, source_id, ordinal, title, content, byte_count)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		const update_returned = this.db.prepare(`
			UPDATE context_sources SET returned_byte_count = ? WHERE id = ?
		`);

		this.db.exec('BEGIN');
		try {
			insert.run(
				source_id,
				session_id,
				project_path,
				input.tool_name,
				input.input_summary ?? null,
				created_at,
				bytes,
				lines,
				content_hash,
				preview_bytes,
			);
			for (const chunk of chunks) {
				insert_chunk.run(
					chunk.id,
					chunk.source_id,
					chunk.ordinal,
					chunk.title,
					chunk.content,
					chunk.byte_count,
				);
			}
			const provisional: StoredContextOutput = {
				source_id,
				bytes,
				lines,
				preview,
				receipt: '',
				chunk_count: chunks.length,
				returned_bytes: 0,
			};
			const receipt = summarize_source(provisional, input.tool_name);
			const returned_bytes = Buffer.byteLength(receipt, 'utf8');
			update_returned.run(returned_bytes, source_id);
			this.db.exec('COMMIT');
			return { ...provisional, receipt, returned_bytes };
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	list(
		options: ContextScopeOptions & {
			source_id?: string;
			tool_name?: string;
			limit?: number;
			offset?: number;
			newer_than_days?: number;
			older_than_days?: number;
		} = {},
	): ContextListResult[] {
		const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
		const offset = Math.max(0, options.offset ?? 0);
		const scoped = this.scoped_filter('context_sources', options);
		const filters: string[] = [...scoped.where];
		const params: Array<string | number> = [...scoped.params];
		if (options.source_id) {
			filters.push('context_sources.id = ?');
			params.push(options.source_id);
		}
		if (options.tool_name) {
			filters.push('context_sources.tool_name = ?');
			params.push(options.tool_name);
		}
		if (options.newer_than_days !== undefined) {
			filters.push('context_sources.created_at >= ?');
			params.push(
				Date.now() - options.newer_than_days * 24 * 60 * 60 * 1000,
			);
		}
		if (options.older_than_days !== undefined) {
			filters.push('context_sources.created_at < ?');
			params.push(
				Date.now() - options.older_than_days * 24 * 60 * 60 * 1000,
			);
		}
		params.push(limit, offset);
		const where_clause = filters.length
			? `WHERE ${filters.join(' AND ')}`
			: '';
		const stmt = this.db.prepare(`
			SELECT
				context_sources.id as source_id,
				context_sources.created_at,
				context_sources.project_path,
				context_sources.session_id,
				context_sources.tool_name,
				context_sources.input_summary,
				context_sources.byte_count,
				context_sources.line_count,
				COUNT(context_chunks.id) as chunk_count,
				(
					SELECT title FROM context_chunks first_chunk
					WHERE first_chunk.source_id = context_sources.id
					ORDER BY ordinal LIMIT 1
				) as first_chunk_title,
				(
					SELECT substr(content, 1, 240) FROM context_chunks first_chunk
					WHERE first_chunk.source_id = context_sources.id
					ORDER BY ordinal LIMIT 1
				) as preview
			FROM context_sources
			LEFT JOIN context_chunks ON context_chunks.source_id = context_sources.id
			${where_clause}
			GROUP BY context_sources.id
			ORDER BY context_sources.created_at DESC
			LIMIT ? OFFSET ?
		`);
		return (stmt.all(...params) as unknown as ListRow[]).map(
			(row) => ({
				source_id: row.source_id,
				created_at: row.created_at,
				project_path: row.project_path,
				session_id: row.session_id,
				tool_name: row.tool_name,
				input_summary: row.input_summary,
				bytes: row.byte_count,
				lines: row.line_count,
				chunk_count: row.chunk_count,
				first_chunk_title: row.first_chunk_title,
				preview: row.preview,
			}),
		);
	}

	search(
		query: string,
		options: ContextScopeOptions & {
			source_id?: string;
			limit?: number;
			tool_name?: string;
		} = {},
	): ContextSearchResult[] {
		const limit = Math.max(1, Math.min(options.limit ?? 5, 25));
		const match = escape_fts5_query(query);
		const scoped = this.scoped_filter('context_sources', options);
		const filters: string[] = [...scoped.where];
		const params: Array<string | number> = [match, ...scoped.params];
		if (options.source_id) {
			filters.push('context_sources.id = ?');
			params.push(options.source_id);
		}
		if (options.tool_name) {
			filters.push('context_sources.tool_name = ?');
			params.push(options.tool_name);
		}
		params.push(limit);
		const where_filters = filters.length
			? ` AND ${filters.join(' AND ')}`
			: '';
		const stmt = this.db.prepare(`
			SELECT
				context_sources.id,
				context_sources.tool_name,
				context_sources.created_at,
				context_sources.byte_count,
				context_sources.line_count,
				context_chunks.id as chunk_id,
				context_chunks.ordinal,
				context_chunks.title,
				context_chunks.content,
				bm25(context_chunks_fts, 5.0, 1.0) as rank
			FROM context_chunks_fts
			JOIN context_chunks ON context_chunks.rowid = context_chunks_fts.rowid
			JOIN context_sources ON context_sources.id = context_chunks.source_id
			WHERE context_chunks_fts MATCH ?${where_filters}
			ORDER BY rank
			LIMIT ?
		`);
		return (stmt.all(...params) as unknown as SearchRow[]).map(
			(row) => ({
				source_id: row.id,
				chunk_id: row.chunk_id,
				ordinal: row.ordinal,
				title: row.title,
				content: row.content,
				tool_name: row.tool_name,
				created_at: row.created_at,
				bytes: row.byte_count,
				lines: row.line_count,
				rank: row.rank,
			}),
		);
	}

	get(
		source_id: string,
		chunk_id?: string,
		options: ContextScopeOptions = {},
	): ContextChunk[] {
		const scoped = this.scoped_filter('context_sources', options);
		const filters = ['context_chunks.source_id = ?', ...scoped.where];
		const params: Array<string | number> = [
			source_id,
			...scoped.params,
		];
		if (chunk_id) {
			filters.push('context_chunks.id = ?');
			params.push(chunk_id);
		}
		const stmt = this.db.prepare(`
			SELECT
				context_chunks.id,
				context_chunks.source_id,
				context_chunks.ordinal,
				context_chunks.title,
				context_chunks.content,
				context_chunks.byte_count
			FROM context_chunks
			JOIN context_sources ON context_sources.id = context_chunks.source_id
			WHERE ${filters.join(' AND ')}
			ORDER BY context_chunks.ordinal
		`);
		return stmt.all(...params) as unknown as ContextChunk[];
	}

	stats(): ContextStats {
		const source = this.db
			.prepare(`
			SELECT
				COUNT(*) as sources,
				COALESCE(SUM(byte_count), 0) as bytes_stored,
				COALESCE(SUM(returned_byte_count), 0) as bytes_returned,
				MIN(created_at) as oldest_created_at,
				MAX(created_at) as newest_created_at
			FROM context_sources
		`)
			.get() as {
			sources: number;
			bytes_stored: number;
			bytes_returned: number;
			oldest_created_at: number | null;
			newest_created_at: number | null;
		};
		const chunks = this.db
			.prepare('SELECT COUNT(*) as chunks FROM context_chunks')
			.get() as { chunks: number };
		const bytes_saved = source.bytes_stored - source.bytes_returned;
		const reduction_pct =
			source.bytes_stored > 0
				? Math.round((bytes_saved / source.bytes_stored) * 1000) / 10
				: 0;
		const db_bytes = file_size(this.db_path);
		const wal_bytes = file_size(`${this.db_path}-wal`);
		const policy = parse_context_retention_policy();
		return {
			sources: source.sources,
			chunks: chunks.chunks,
			bytes_stored: source.bytes_stored,
			bytes_returned: source.bytes_returned,
			bytes_saved,
			reduction_pct,
			db_bytes,
			wal_bytes,
			total_bytes: db_bytes + wal_bytes,
			oldest_created_at: source.oldest_created_at,
			newest_created_at: source.newest_created_at,
			retention_days: policy.retention_days,
			purge_on_shutdown: policy.purge_on_shutdown,
			max_mb: policy.max_mb,
		};
	}

	cleanup(
		policy: ContextRetentionPolicy = parse_context_retention_policy(),
	): ContextCleanupResult {
		let age_deleted = 0;
		if (policy.retention_days !== null) {
			age_deleted = this.purge({
				older_than_days: policy.retention_days,
			});
		}
		const size_deleted = policy.max_bytes
			? this.purge_to_max_stored_bytes(policy.max_bytes)
			: 0;
		return {
			deleted: age_deleted + size_deleted,
			age_deleted,
			size_deleted,
			policy,
		};
	}

	private purge_to_max_stored_bytes(max_bytes: number): number {
		const total_row = this.db
			.prepare(
				'SELECT COALESCE(SUM(byte_count), 0) as bytes FROM context_sources',
			)
			.get() as { bytes: number };
		let total = total_row.bytes;
		if (total <= max_bytes) return 0;
		const rows = this.db
			.prepare(
				'SELECT id, byte_count FROM context_sources ORDER BY created_at ASC',
			)
			.all() as Array<{ id: string; byte_count: number }>;
		const delete_source = this.db.prepare(
			'DELETE FROM context_sources WHERE id = ?',
		);
		let deleted = 0;
		for (const row of rows) {
			if (total <= max_bytes) break;
			const result = delete_source.run(row.id);
			if (Number(result.changes ?? 0) > 0) {
				deleted += 1;
				total -= row.byte_count;
			}
		}
		return deleted;
	}

	purge(
		options: ContextScopeOptions & {
			older_than_days?: number;
			source_id?: string;
		} = {},
	): number {
		return this.purge_with_details(options).deleted;
	}

	purge_with_details(
		options: ContextScopeOptions & {
			older_than_days?: number;
			source_id?: string;
		} = {},
	): ContextPurgeDetails {
		const filters: string[] = [];
		const params: Array<string | number> = [];
		if (options.source_id) {
			filters.push('id = ?');
			params.push(options.source_id);
		}
		if (options.project_path === null) {
			filters.push('project_path IS NULL');
		} else if (options.project_path !== undefined) {
			filters.push('project_path = ?');
			params.push(options.project_path);
		}
		if (options.session_id === null) {
			filters.push('session_id IS NULL');
		} else if (options.session_id !== undefined) {
			filters.push('session_id = ?');
			params.push(options.session_id);
		}
		const days = options.older_than_days;
		if (days !== undefined) {
			const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
			filters.push('created_at < ?');
			params.push(cutoff);
		}
		if (filters.length === 0) {
			return { deleted: 0 };
		}
		const result = this.db
			.prepare(
				`DELETE FROM context_sources WHERE ${filters.join(' AND ')}`,
			)
			.run(...params);
		return {
			deleted: Number(result.changes ?? 0),
			source_id: options.source_id,
			project_path: options.project_path,
			session_id: options.session_id,
			older_than_days: options.older_than_days,
		};
	}

	close(): void {
		this.db.close();
	}
}

function file_size(path: string): number {
	return existsSync(path) ? statSync(path).size : 0;
}
