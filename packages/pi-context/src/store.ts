import { redact_text } from '@spences10/pi-redact';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_CONTEXT_MAX_BYTES = 24 * 1024;
export const DEFAULT_CONTEXT_MAX_LINES = 300;
const DEFAULT_PREVIEW_LINES = 80;
const DEFAULT_PREVIEW_BYTES = 8 * 1024;

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS context_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_path TEXT,
  tool_name TEXT NOT NULL,
  input_summary TEXT,
  created_at INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  preview_byte_count INTEGER NOT NULL DEFAULT 0,
  returned_byte_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS context_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  byte_count INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS context_chunks_fts USING fts5(
  title,
  content,
  content='context_chunks',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS context_chunks_ai AFTER INSERT ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS context_chunks_ad AFTER DELETE ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(context_chunks_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS context_chunks_au AFTER UPDATE ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(context_chunks_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO context_chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_context_sources_created ON context_sources(created_at);
CREATE INDEX IF NOT EXISTS idx_context_sources_session ON context_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_context_sources_project ON context_sources(project_path);
CREATE INDEX IF NOT EXISTS idx_context_chunks_source ON context_chunks(source_id, ordinal);
`;

export interface ContextStoreOptions {
	db_path?: string;
	project_path?: string;
	session_id?: string | null;
	max_bytes?: number;
	max_lines?: number;
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
	global_options = { ...global_options, ...options };
	if (!enabled) global_store = null;
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
		this.db.exec(SCHEMA);
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

	search(
		query: string,
		options: {
			source_id?: string;
			limit?: number;
			tool_name?: string;
		} = {},
	): ContextSearchResult[] {
		const limit = Math.max(1, Math.min(options.limit ?? 5, 25));
		const match = escape_fts5_query(query);
		const filters: string[] = [];
		const params: Array<string | number> = [match];
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

	get(source_id: string, chunk_id?: string): ChunkRow[] {
		const stmt = chunk_id
			? this.db.prepare(`
				SELECT id, source_id, ordinal, title, content, byte_count
				FROM context_chunks WHERE source_id = ? AND id = ? ORDER BY ordinal
			`)
			: this.db.prepare(`
				SELECT id, source_id, ordinal, title, content, byte_count
				FROM context_chunks WHERE source_id = ? ORDER BY ordinal
			`);
		const params = chunk_id ? [source_id, chunk_id] : [source_id];
		return stmt.all(...params) as unknown as ChunkRow[];
	}

	stats(): ContextStats {
		const source = this.db
			.prepare(`
			SELECT
				COUNT(*) as sources,
				COALESCE(SUM(byte_count), 0) as bytes_stored,
				COALESCE(SUM(returned_byte_count), 0) as bytes_returned
			FROM context_sources
		`)
			.get() as {
			sources: number;
			bytes_stored: number;
			bytes_returned: number;
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
		};
	}

	purge(
		options: { older_than_days?: number; source_id?: string } = {},
	): number {
		if (options.source_id) {
			const result = this.db
				.prepare('DELETE FROM context_sources WHERE id = ?')
				.run(options.source_id);
			return Number(result.changes ?? 0);
		}
		const days = options.older_than_days ?? 14;
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const result = this.db
			.prepare('DELETE FROM context_sources WHERE created_at < ?')
			.run(cutoff);
		return Number(result.changes ?? 0);
	}

	close(): void {
		this.db.close();
	}
}

function file_size(path: string): number {
	return existsSync(path) ? statSync(path).size : 0;
}
