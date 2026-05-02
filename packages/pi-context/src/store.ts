import { redact_text } from '@spences10/pi-redact';
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_CONTEXT_MAX_BYTES = 24 * 1024;
export const DEFAULT_CONTEXT_MAX_LINES = 300;
export const DEFAULT_CONTEXT_RETENTION_DAYS = 7;
const DEFAULT_PREVIEW_LINES = 80;
const DEFAULT_PREVIEW_BYTES = 8 * 1024;

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf8',
);
const LATEST_CONTEXT_SCHEMA_VERSION = 1;
const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;
const CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
const MIGRATIONS: Record<number, string> = {
	1: SCHEMA,
};

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
}

interface SourceRow {
	id: string;
	tool_name: string;
	created_at: number;
	byte_count: number;
	line_count: number;
}

interface SearchRow extends SourceRow {
	chunk_id: string;
	ordinal: number;
	title: string | null;
	content: string;
	rank: number;
}

interface ScopedFilter {
	where: string[];
	params: Array<string | number>;
}

interface ListRow {
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

interface ChunkRow {
	id: string;
	source_id: string;
	ordinal: number;
	title: string | null;
	content: string;
	byte_count: number;
}

let global_options: ContextStoreOptions = {};
let global_enabled = false;
let global_store: ContextStore | null = null;

export function parse_context_retention_policy(
	env: NodeJS.ProcessEnv = process.env,
): ContextRetentionPolicy {
	const retention_days = parse_optional_positive_number(
		env.MY_PI_CONTEXT_RETENTION_DAYS,
		DEFAULT_CONTEXT_RETENTION_DAYS,
	);
	const max_mb = parse_optional_positive_number(
		env.MY_PI_CONTEXT_MAX_MB,
		null,
	);
	return {
		retention_days,
		purge_on_shutdown: parse_boolean_env(
			env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN,
		),
		max_mb,
		max_bytes: max_mb === null ? null : max_mb * 1024 * 1024,
	};
}

function parse_optional_positive_number(
	value: string | undefined,
	fallback: number | null,
): number | null {
	if (value === undefined || value.trim() === '') return fallback;
	const normalized = value.trim().toLowerCase();
	if (
		normalized === '0' ||
		normalized === 'off' ||
		normalized === 'false' ||
		normalized === 'none' ||
		normalized === 'disabled'
	)
		return null;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parse_boolean_env(value: string | undefined): boolean {
	if (!value) return false;
	return ['1', 'true', 'yes', 'on'].includes(
		value.trim().toLowerCase(),
	);
}

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

export function count_lines(text: string): number {
	if (!text) return 0;
	return text.split('\n').length;
}

export function should_index_text(
	text: string,
	options: Pick<ContextStoreOptions, 'max_bytes' | 'max_lines'> = {},
): boolean {
	const max_bytes = options.max_bytes ?? DEFAULT_CONTEXT_MAX_BYTES;
	const max_lines = options.max_lines ?? DEFAULT_CONTEXT_MAX_LINES;
	return (
		Buffer.byteLength(text, 'utf8') > max_bytes ||
		count_lines(text) > max_lines
	);
}

export function escape_fts5_query(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return '""';
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.replace(
			/"(.*)"/s,
			(_match, inner: string) => `"${inner.replace(/"/g, '""')}"`,
		);
	}

	const tokens = trimmed
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean)
		.map((token) => {
			const is_prefix = token.endsWith('*');
			const base = is_prefix ? token.slice(0, -1) : token;
			const safe = base
				.replace(/["'(){}[\]^:./\\+-]/g, ' ')
				.trim()
				.replace(/\s+/g, ' ');
			if (!safe) return '';
			const quoted = `"${safe.replace(/"/g, '""')}"`;
			return is_prefix ? `${quoted}*` : quoted;
		})
		.filter(Boolean);

	return tokens.length > 0 ? tokens.join(' ') : '""';
}

export function make_preview(
	text: string,
	max_lines = DEFAULT_PREVIEW_LINES,
	max_bytes = DEFAULT_PREVIEW_BYTES,
): string {
	const lines = text.split('\n');
	let preview: string;
	if (lines.length <= max_lines) {
		preview = text;
	} else {
		const head_count = Math.ceil(max_lines / 2);
		const tail_count = Math.floor(max_lines / 2);
		const omitted = lines.length - head_count - tail_count;
		preview = [
			...lines.slice(0, head_count),
			``,
			`[... ${omitted} lines omitted; indexed in context sidecar ...]`,
			``,
			...lines.slice(-tail_count),
		].join('\n');
	}

	return take_utf8_bytes(preview, max_bytes);
}

function take_utf8_bytes(text: string, max_bytes: number): string {
	if (Buffer.byteLength(text, 'utf8') <= max_bytes) return text;
	let bytes = 0;
	let output = '';
	for (const char of text) {
		const char_bytes = Buffer.byteLength(char, 'utf8');
		if (bytes + char_bytes > max_bytes) break;
		bytes += char_bytes;
		output += char;
	}
	return `${output}\n[... preview truncated at ${format_bytes(max_bytes)} ...]`;
}

function chunk_text(text: string, source_id: string): ChunkRow[] {
	const paragraphs = text.split(/\n{2,}/);
	const chunks: string[] = [];
	let current = '';
	const target_bytes = 4096;

	for (const paragraph of paragraphs) {
		if (Buffer.byteLength(paragraph, 'utf8') > target_bytes) {
			if (current) chunks.push(current);
			chunks.push(...split_large_chunk(paragraph, target_bytes));
			current = '';
			continue;
		}

		const next = current ? `${current}\n\n${paragraph}` : paragraph;
		if (Buffer.byteLength(next, 'utf8') > target_bytes && current) {
			chunks.push(current);
			current = paragraph;
		} else {
			current = next;
		}
	}
	if (current) chunks.push(current);
	if (chunks.length === 0) chunks.push(text);

	return chunks.map((content, index) => ({
		id: `${source_id}_${String(index + 1).padStart(4, '0')}`,
		source_id,
		ordinal: index + 1,
		title: first_non_empty_line(content),
		content,
		byte_count: Buffer.byteLength(content, 'utf8'),
	}));
}

function split_large_chunk(
	text: string,
	target_bytes: number,
): string[] {
	const chunks: string[] = [];
	let current = '';

	for (const line of text.split('\n')) {
		const next = current ? `${current}\n${line}` : line;
		if (Buffer.byteLength(next, 'utf8') <= target_bytes) {
			current = next;
			continue;
		}

		if (current) chunks.push(current);
		if (Buffer.byteLength(line, 'utf8') <= target_bytes) {
			current = line;
			continue;
		}

		let rest = line;
		while (Buffer.byteLength(rest, 'utf8') > target_bytes) {
			const [head, tail] = split_utf8_at_byte(rest, target_bytes);
			chunks.push(head);
			rest = tail;
		}
		current = rest;
	}

	if (current) chunks.push(current);
	return chunks;
}

function split_utf8_at_byte(
	text: string,
	max_bytes: number,
): [string, string] {
	let bytes = 0;
	let index = 0;
	for (const char of text) {
		const char_bytes = Buffer.byteLength(char, 'utf8');
		if (bytes + char_bytes > max_bytes) break;
		bytes += char_bytes;
		index += char.length;
	}
	return [text.slice(0, index), text.slice(index)];
}

function first_non_empty_line(text: string): string | null {
	const line = text
		.split('\n')
		.map((value) => value.trim())
		.find(Boolean);
	return line ? line.slice(0, 120) : null;
}

function format_bytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function summarize_source(
	result: StoredContextOutput,
	tool_name: string,
): string {
	return [
		`[context-sidecar] Large ${tool_name} output indexed locally`,
		``,
		`Source: ${result.source_id}`,
		`Size: ${format_bytes(result.bytes)}, ${result.lines} lines, ${result.chunk_count} chunks`,
		`Use context_search query:"..." source_id:"${result.source_id}" to inspect it.`,
		`Use context_get source_id:"${result.source_id}" for exact chunks.`,
		``,
		result.preview,
	].join('\n');
}

function get_user_version(db: DatabaseSync): number {
	const row = db.prepare('PRAGMA user_version').get() as {
		user_version: number;
	};
	return row.user_version;
}

function apply_schema(db: DatabaseSync): void {
	db.exec(PERSISTENT_PRAGMAS);
	db.exec(CONNECTION_PRAGMAS);

	const current_version = get_user_version(db);
	if (current_version > LATEST_CONTEXT_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`Context database schema version ${current_version} is newer than supported version ${LATEST_CONTEXT_SCHEMA_VERSION}`,
		);
	}

	for (
		let next_version = current_version + 1;
		next_version <= LATEST_CONTEXT_SCHEMA_VERSION;
		next_version++
	) {
		const migration = MIGRATIONS[next_version];
		if (!migration) {
			db.close();
			throw new Error(
				`Missing context migration for schema version ${next_version}`,
			);
		}

		db.exec('BEGIN');
		try {
			db.exec(migration);
			db.exec(`PRAGMA user_version = ${next_version}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			db.close();
			throw error;
		}
	}
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
		const source_id = `ctx_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
		const created_at = Date.now();
		const content_hash = createHash('sha256')
			.update(text)
			.digest('hex');
		const chunks = chunk_text(text, source_id);
		const preview = make_preview(text);
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
				input.session_id ?? this.session_id,
				input.project_path ?? this.project_path,
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
	): ChunkRow[] {
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
		return stmt.all(...params) as unknown as ChunkRow[];
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
		if (filters.length === 0) return 0;
		const result = this.db
			.prepare(
				`DELETE FROM context_sources WHERE ${filters.join(' AND ')}`,
			)
			.run(...params);
		return Number(result.changes ?? 0);
	}

	close(): void {
		this.db.close();
	}
}

function file_size(path: string): number {
	return existsSync(path) ? statSync(path).size : 0;
}
