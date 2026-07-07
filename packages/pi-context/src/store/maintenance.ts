import { with_sqlite_busy_retry } from '@spences10/pi-sqlite-core';
import { existsSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { parse_context_retention_policy } from '../policy.js';
import type {
	ContextCleanupResult,
	ContextPurgeDetails,
	ContextRetentionPolicy,
	ContextScopeOptions,
	ContextStats,
	ScopedFilter,
} from '../types.js';

export interface ContextStoreMaintenanceTarget {
	db_path: string;
	db: DatabaseSync;
	scoped_filter(
		alias: string,
		options?: ContextScopeOptions,
	): ScopedFilter;
	purge(
		options?: ContextScopeOptions & {
			older_than_days?: number;
			source_id?: string;
		},
	): number;
	purge_to_max_stored_bytes(max_bytes: number): number;
}

function file_size(path: string): number {
	return existsSync(path) ? statSync(path).size : 0;
}

function count_stats(
	store: ContextStoreMaintenanceTarget,
	options: ContextScopeOptions,
): {
	sources: number;
	chunks: number;
	bytes_stored: number;
	bytes_returned: number;
	oldest_created_at: number | null;
	newest_created_at: number | null;
} {
	const scoped = store.scoped_filter('context_sources', options);
	const where_clause = scoped.where.length
		? `WHERE ${scoped.where.join(' AND ')}`
		: '';
	const source = store.db
		.prepare(`
			SELECT
				COUNT(*) as sources,
				COALESCE(SUM(byte_count), 0) as bytes_stored,
				COALESCE(SUM(returned_byte_count), 0) as bytes_returned,
				MIN(created_at) as oldest_created_at,
				MAX(created_at) as newest_created_at
			FROM context_sources
			${where_clause}
		`)
		.get(...scoped.params) as {
		sources: number;
		bytes_stored: number;
		bytes_returned: number;
		oldest_created_at: number | null;
		newest_created_at: number | null;
	};
	const chunks = store.db
		.prepare(`
			SELECT COUNT(context_chunks.id) as chunks
			FROM context_chunks
			JOIN context_sources ON context_sources.id = context_chunks.source_id
			${where_clause}
		`)
		.get(...scoped.params) as { chunks: number };
	return { ...source, chunks: chunks.chunks };
}

export function context_store_stats(
	store: ContextStoreMaintenanceTarget,
	options: ContextScopeOptions = { global: true },
): ContextStats {
	const source = count_stats(store, options);
	const global = options.global
		? source
		: count_stats(store, { global: true });
	const bytes_saved = source.bytes_stored - source.bytes_returned;
	const reduction_pct =
		source.bytes_stored > 0
			? Math.round((bytes_saved / source.bytes_stored) * 1000) / 10
			: 0;
	const db_bytes = file_size(store.db_path);
	const wal_bytes = file_size(`${store.db_path}-wal`);
	const policy = parse_context_retention_policy();
	return {
		sources: source.sources,
		chunks: source.chunks,
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
		scope_project_path:
			options.global === true ? null : (options.project_path ?? null),
		scope_session_id:
			options.global === true ? null : (options.session_id ?? null),
		global_sources: global.sources,
		global_chunks: global.chunks,
		global_bytes_stored: global.bytes_stored,
		global_oldest_created_at: global.oldest_created_at,
		global_newest_created_at: global.newest_created_at,
	};
}

export function context_store_cleanup(
	store: ContextStoreMaintenanceTarget,
	policy: ContextRetentionPolicy = parse_context_retention_policy(),
): ContextCleanupResult {
	let age_deleted = 0;
	if (policy.retention_days !== null) {
		age_deleted = store.purge({
			older_than_days: policy.retention_days,
		});
	}
	const size_deleted = policy.max_bytes
		? store.purge_to_max_stored_bytes(policy.max_bytes)
		: 0;
	return {
		deleted: age_deleted + size_deleted,
		age_deleted,
		size_deleted,
		policy,
	};
}

export function context_store_purge_to_max_stored_bytes(
	store: ContextStoreMaintenanceTarget,
	max_bytes: number,
): number {
	const total_row = store.db
		.prepare(
			'SELECT COALESCE(SUM(byte_count), 0) as bytes FROM context_sources',
		)
		.get() as { bytes: number };
	let total = total_row.bytes;
	if (total <= max_bytes) return 0;
	const rows = store.db
		.prepare(
			'SELECT id, byte_count FROM context_sources ORDER BY created_at ASC',
		)
		.all() as Array<{ id: string; byte_count: number }>;
	const delete_source = store.db.prepare(
		'DELETE FROM context_sources WHERE id = ?',
	);
	let deleted = 0;
	for (const row of rows) {
		if (total <= max_bytes) break;
		const result = with_sqlite_busy_retry(
			() => delete_source.run(row.id),
			{
				operation: 'Purge context source',
			},
		);
		if (Number(result.changes ?? 0) > 0) {
			deleted += 1;
			total -= row.byte_count;
		}
	}
	return deleted;
}

export function context_store_purge_with_details(
	store: ContextStoreMaintenanceTarget,
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
	const result = with_sqlite_busy_retry(
		() =>
			store.db
				.prepare(
					`DELETE FROM context_sources WHERE ${filters.join(' AND ')}`,
				)
				.run(...params),
		{ operation: 'Purge context sources' },
	);
	return {
		deleted: Number(result.changes ?? 0),
		source_id: options.source_id,
		project_path: options.project_path,
		session_id: options.session_id,
		older_than_days: options.older_than_days,
	};
}
