import type { DatabaseSync } from 'node:sqlite';
import type {
	ChunkSummaryRow,
	ContextChunk,
	ContextChunkSummary,
	ContextScopeOptions,
	ScopedFilter,
} from '../types.js';

export interface ContextStoreRetrievalTarget {
	db: DatabaseSync;
	scoped_filter(
		alias: string,
		options?: ContextScopeOptions,
	): ScopedFilter;
}

function escape_regexp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chunk_reference_to_ordinal(
	source_id: string,
	chunk_id: string,
): number | null {
	const trimmed = chunk_id.trim();
	const legacy_match = new RegExp(
		`^${escape_regexp(source_id)}:chunk:(\\d+)$`,
	).exec(trimmed);
	if (legacy_match) {
		const value = Number.parseInt(legacy_match[1]!, 10);
		if (!Number.isSafeInteger(value)) return null;
		return value <= 0 ? 1 : value;
	}
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number.parseInt(trimmed, 10);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function context_store_chunk_summary(
	store: ContextStoreRetrievalTarget,
	source_id: string,
	options: ContextScopeOptions = {},
): ContextChunkSummary | null {
	const scoped = store.scoped_filter('context_sources', options);
	const filters = ['context_sources.id = ?', ...scoped.where];
	const params: Array<string | number> = [
		source_id,
		...scoped.params,
	];
	const row = store.db
		.prepare(`
			SELECT
				context_sources.id as source_id,
				COUNT(context_chunks.id) as chunk_count,
				(
					SELECT first_chunk.id FROM context_chunks first_chunk
					WHERE first_chunk.source_id = context_sources.id
					ORDER BY first_chunk.ordinal LIMIT 1
				) as first_chunk_id,
				(
					SELECT last_chunk.id FROM context_chunks last_chunk
					WHERE last_chunk.source_id = context_sources.id
					ORDER BY last_chunk.ordinal DESC LIMIT 1
				) as last_chunk_id,
				MIN(context_chunks.ordinal) as first_ordinal,
				MAX(context_chunks.ordinal) as last_ordinal
			FROM context_sources
			LEFT JOIN context_chunks ON context_chunks.source_id = context_sources.id
			WHERE ${filters.join(' AND ')}
			GROUP BY context_sources.id
		`)
		.get(...params) as ChunkSummaryRow | undefined;
	return row ?? null;
}

export function context_store_get(
	store: ContextStoreRetrievalTarget,
	source_id: string,
	chunk_id?: string,
	options: ContextScopeOptions = {},
): ContextChunk[] {
	const scoped = store.scoped_filter('context_sources', options);
	const filters = ['context_chunks.source_id = ?', ...scoped.where];
	const params: Array<string | number> = [
		source_id,
		...scoped.params,
	];
	if (chunk_id) {
		const ordinal = chunk_reference_to_ordinal(source_id, chunk_id);
		if (ordinal) {
			filters.push('context_chunks.ordinal = ?');
			params.push(ordinal);
		} else {
			filters.push('context_chunks.id = ?');
			params.push(chunk_id);
		}
	}
	const stmt = store.db.prepare(`
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
