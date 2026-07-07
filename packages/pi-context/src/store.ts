import { redact_text } from '@spences10/pi-redact';
import { with_sqlite_transaction } from '@spences10/pi-sqlite-core';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { get_context_capture_limits } from './config.js';
import { parse_context_retention_policy } from './policy.js';
import { apply_schema } from './schema.js';
import {
	context_store_cleanup,
	context_store_purge_to_max_stored_bytes,
	context_store_purge_with_details,
	context_store_stats,
} from './store/maintenance.js';
import {
	default_context_db_path,
	get_context_store as get_context_store_with_ctor,
	maybe_store_context_output as maybe_store_context_output_with_ctor,
} from './store/registry.js';
import {
	context_store_chunk_summary,
	context_store_get,
} from './store/retrieval.js';
import {
	chunk_text,
	count_lines,
	escape_fts5_query,
	make_preview,
	relaxed_fts5_query,
	should_index_text,
	summarize_source,
} from './text.js';
import type {
	ContextChunk,
	ContextChunkSelectionOptions,
	ContextChunkSummary,
	ContextCleanupResult,
	ContextExportContent,
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
	default_context_db_path,
	is_context_sidecar_enabled,
	set_context_sidecar_enabled,
} from './store/registry.js';
export {
	count_lines,
	DEFAULT_CONTEXT_MAX_BYTES,
	DEFAULT_CONTEXT_MAX_LINES,
	escape_fts5_query,
	make_preview,
	should_index_text,
} from './text.js';
export type {
	ContextChunk,
	ContextChunkSelectionOptions,
	ContextChunkSummary,
	ContextCleanupResult,
	ContextExportContent,
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

export function get_context_store(
	options: ContextStoreOptions = {},
): ContextStore {
	return get_context_store_with_ctor(ContextStore, options);
}

export function maybe_store_context_output(
	input: StoreContextInput,
	options: ContextStoreOptions = {},
): StoredContextOutput | null {
	return maybe_store_context_output_with_ctor(
		ContextStore,
		input,
		options,
	);
}

export class ContextStore {
	readonly db_path: string;
	db: DatabaseSync;
	private project_path: string | null;
	private session_id: string | null;
	private max_bytes: number;
	private max_lines: number;

	constructor(options: ContextStoreOptions = {}) {
		this.db_path = options.db_path ?? default_context_db_path();
		this.project_path = options.project_path ?? process.cwd();
		this.session_id = options.session_id ?? null;
		const capture_limits = get_context_capture_limits();
		this.max_bytes = options.max_bytes ?? capture_limits.max_bytes;
		this.max_lines = options.max_lines ?? capture_limits.max_lines;

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
		const capture_limits = get_context_capture_limits();
		this.max_bytes = options.max_bytes ?? capture_limits.max_bytes;
		this.max_lines = options.max_lines ?? capture_limits.max_lines;
	}

	scoped_filter(
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
	): {
		id: string;
		chunk_count: number;
		first_chunk_id: string | null;
	} | null {
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
				SELECT
					context_sources.id,
					COUNT(context_chunks.id) as chunk_count,
					(
						SELECT first_chunk.id FROM context_chunks first_chunk
						WHERE first_chunk.source_id = context_sources.id
						ORDER BY first_chunk.ordinal LIMIT 1
					) as first_chunk_id
				FROM context_sources
				LEFT JOIN context_chunks ON context_chunks.source_id = context_sources.id
				WHERE ${filters.join(' AND ')}
				GROUP BY context_sources.id
				ORDER BY context_sources.created_at DESC
				LIMIT 1
			`)
			.get(...params) as
			| {
					id: string;
					chunk_count: number;
					first_chunk_id: string | null;
			  }
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
			project_path,
			session_id,
		});
		if (duplicate) {
			const provisional: StoredContextOutput = {
				source_id: duplicate.id,
				bytes,
				lines,
				preview,
				receipt: '',
				chunk_count: duplicate.chunk_count,
				first_chunk_id: duplicate.first_chunk_id,
				returned_bytes: 0,
				project_path,
				session_id,
				deduped: true,
				capture_max_bytes: this.max_bytes,
				capture_max_lines: this.max_lines,
			};
			const receipt = summarize_source(provisional, input.tool_name);
			const returned_bytes = Buffer.byteLength(receipt, 'utf8');
			with_sqlite_transaction(
				this.db,
				() => {
					this.db
						.prepare(
							'UPDATE context_sources SET returned_byte_count = returned_byte_count + ? WHERE id = ?',
						)
						.run(returned_bytes, duplicate.id);
				},
				{ operation: 'Update context receipt bytes' },
			);
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

		return with_sqlite_transaction(
			this.db,
			() => {
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
					first_chunk_id: chunks[0]?.id ?? null,
					returned_bytes: 0,
					project_path,
					session_id,
					capture_max_bytes: this.max_bytes,
					capture_max_lines: this.max_lines,
				};
				const receipt = summarize_source(
					provisional,
					input.tool_name,
				);
				const returned_bytes = Buffer.byteLength(receipt, 'utf8');
				update_returned.run(returned_bytes, source_id);
				return { ...provisional, receipt, returned_bytes };
			},
			{ operation: 'Store context output' },
		);
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
			full_content?: boolean;
		} = {},
	): ContextSearchResult[] {
		const limit = Math.max(1, Math.min(options.limit ?? 5, 25));
		const strict = escape_fts5_query(query);
		const relaxed = relaxed_fts5_query(query);
		const results = this.search_match(strict, options, limit);
		if (results.length >= limit || !relaxed || relaxed === strict)
			return results;

		const seen = new Set(results.map((result) => result.chunk_id));
		for (const result of this.search_match(relaxed, options, limit)) {
			if (seen.has(result.chunk_id)) continue;
			results.push(result);
			seen.add(result.chunk_id);
			if (results.length >= limit) break;
		}
		return results;
	}

	private search_match(
		match: string,
		options: ContextScopeOptions & {
			source_id?: string;
			tool_name?: string;
			full_content?: boolean;
		},
		limit: number,
	): ContextSearchResult[] {
		const scoped = options.source_id
			? { where: [], params: [] }
			: this.scoped_filter('context_sources', options);
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
		const content_expression = options.full_content
			? 'context_chunks.content'
			: "snippet(context_chunks_fts, 1, '', '', ' … ', 48)";
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
				${content_expression} as content,
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
				snippet: !options.full_content,
			}),
		);
	}

	chunk_summary(
		source_id: string,
		options: ContextScopeOptions = {},
	): ContextChunkSummary | null {
		return context_store_chunk_summary(this, source_id, options);
	}

	get(
		source_id: string,
		chunk_id?: string,
		options: ContextChunkSelectionOptions = {},
	): ContextChunk[] {
		return context_store_get(this, source_id, chunk_id, options);
	}

	export_content(
		source_id: string,
		chunk_id?: string,
		options: ContextChunkSelectionOptions = {},
	): ContextExportContent {
		const chunks = this.get(source_id, chunk_id, options);
		const content = chunks.map((chunk) => chunk.content).join('');
		const hash = chunk_id
			? null
			: this.source_content_hash(source_id, options);
		const verified = hash
			? createHash('sha256').update(content).digest('hex') === hash
			: null;
		return { chunks, content, verified };
	}

	private source_content_hash(
		source_id: string,
		options: ContextScopeOptions = {},
	): string | null {
		const scoped = this.scoped_filter('context_sources', options);
		const filters = ['context_sources.id = ?', ...scoped.where];
		const params: Array<string | number> = [
			source_id,
			...scoped.params,
		];
		const row = this.db
			.prepare(
				`SELECT content_hash FROM context_sources WHERE ${filters.join(' AND ')} LIMIT 1`,
			)
			.get(...params) as { content_hash: string } | undefined;
		return row?.content_hash ?? null;
	}

	stats(
		options: ContextScopeOptions = { global: true },
	): ContextStats {
		return context_store_stats(this, options);
	}

	cleanup(
		policy: ContextRetentionPolicy = parse_context_retention_policy(),
	): ContextCleanupResult {
		return context_store_cleanup(this, policy);
	}

	purge_to_max_stored_bytes(max_bytes: number): number {
		return context_store_purge_to_max_stored_bytes(this, max_bytes);
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
		return context_store_purge_with_details(this, options);
	}

	close(): void {
		this.db.close();
	}
}
