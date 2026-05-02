import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ContextStore,
	default_context_db_path,
	escape_fts5_query,
	get_context_store,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';

let dirs: string[] = [];
let stores: ContextStore[] = [];

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function create_store(
	options: ConstructorParameters<typeof ContextStore>[0] = {},
): ContextStore {
	const store = new ContextStore({ db_path: temp_db(), ...options });
	stores.push(store);
	return store;
}

function close_db(db: DatabaseSync): void {
	try {
		db.close();
	} catch {
		// best-effort cleanup for assertions that fail mid-test
	}
}

afterEach(() => {
	set_context_sidecar_enabled(false);
	for (const store of stores) {
		try {
			store.close();
		} catch {
			// already closed
		}
	}
	stores = [];
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

describe('ContextStore', () => {
	it('stores oversized output, searches it, and retrieves all and exact chunks', () => {
		const store = create_store({ max_bytes: 10 });
		const text = [
			`alpha intro\n${'noise '.repeat(700)}`,
			`middle haystack\n${'beta '.repeat(900)}`,
			`tail needle-at-end\n${'omega '.repeat(900)}`,
		].join('\n\n');
		const stored = store.store({ text, tool_name: 'bash' });

		expect(stored?.source_id).toMatch(/^ctx_/);
		expect(stored?.receipt).toContain('context-sidecar');
		expect(stored?.receipt).toContain('context_search');
		expect(stored?.chunk_count).toBeGreaterThan(1);

		const results = store.search('needle', {
			source_id: stored!.source_id,
		});
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]).toMatchObject({
			source_id: stored!.source_id,
			tool_name: 'bash',
		});
		expect(results[0].content).toContain('needle-at-end');

		const chunks = store.get(stored!.source_id);
		expect(chunks.map((chunk) => chunk.content).join('\n')).toContain(
			'needle-at-end',
		);
		expect(chunks).toHaveLength(stored!.chunk_count);

		const exact = store.get(stored!.source_id, results[0].chunk_id);
		expect(exact).toHaveLength(1);
		expect(exact[0].id).toBe(results[0].chunk_id);
		expect(exact[0].content).toContain('needle-at-end');

		const stats = store.stats();
		expect(stats.sources).toBe(1);
		expect(stats.chunks).toBe(stored!.chunk_count);
		expect(stats.bytes_stored).toBe(stored!.bytes);
		expect(stats.bytes_returned).toBe(stored!.returned_bytes);
		expect(stats.bytes_saved).toBe(
			stored!.bytes - stored!.returned_bytes,
		);
		expect(stats.bytes_stored).toBeGreaterThan(stats.bytes_returned);
		expect(stats.reduction_pct).toBeGreaterThan(0);
		expect(stats.total_bytes).toBeGreaterThan(0);
	});

	it('splits long line-oriented output into searchable bounded chunks', () => {
		const store = create_store({ max_bytes: 10 });
		const text = Array.from({ length: 1400 }, (_value, index) => {
			const line = index + 1;
			return line === 1173
				? `${line}: TARGET_VALUE=chunk-test-value`
				: `${line}: noise ${'x'.repeat(90)}`;
		}).join('\n');

		const stored = store.store({ text, tool_name: 'bash' });
		expect(stored?.chunk_count).toBeGreaterThan(20);

		const chunks = store.get(stored!.source_id);
		expect(
			Math.max(...chunks.map((chunk) => chunk.byte_count)),
		).toBeLessThanOrEqual(4096);

		const results = store.search('TARGET_VALUE', {
			source_id: stored!.source_id,
		});
		expect(results).toHaveLength(1);
		expect(results[0].content).toContain(
			'1173: TARGET_VALUE=chunk-test-value',
		);
		expect(
			Buffer.byteLength(results[0].content, 'utf8'),
		).toBeLessThanOrEqual(4096);
	});

	it('passes through small output unless forced and stores only redacted content', () => {
		const store = create_store({ max_bytes: 1000 });
		expect(
			store.store({ text: 'small', tool_name: 'read' }),
		).toBeNull();

		const secret = 'SERVICE_PASSWORD=CanaryPassword-Redaction-001!';
		const forced = store.store({
			text: `small ${secret}`,
			tool_name: 'read',
			force: true,
		});
		expect(forced).not.toBeNull();
		expect(forced!.receipt).toContain('[REDACTED:');
		expect(forced!.receipt).not.toContain(secret);

		const chunks = store.get(forced!.source_id);
		expect(chunks[0].content).toContain('[REDACTED:');
		expect(chunks[0].content).not.toContain(secret);

		const db = new DatabaseSync(store.db_path, {
			enableForeignKeyConstraints: true,
		});
		try {
			const row = db
				.prepare(
					'SELECT content FROM context_chunks WHERE source_id = ?',
				)
				.get(forced!.source_id) as { content: string };
			expect(row.content).toContain('[REDACTED:');
			expect(row.content).not.toContain(secret);
		} finally {
			close_db(db);
		}
	});

	it('filters search by source id and tool name and clamps large limits', () => {
		const store = create_store({ max_bytes: 10 });
		const bash = store.store({
			text: `needle bash-only\n${'a '.repeat(100)}`,
			tool_name: 'bash',
		});
		const read = store.store({
			text: `needle read-only\n${'b '.repeat(100)}`,
			tool_name: 'read',
		});

		expect(
			store.search('needle', { source_id: bash!.source_id }),
		).toHaveLength(1);
		expect(
			store.search('needle', { source_id: read!.source_id })[0]
				.content,
		).toContain('read-only');
		expect(
			store.search('needle', { tool_name: 'bash' }),
		).toHaveLength(1);
		expect(
			store.search('needle', { tool_name: 'bash' })[0].content,
		).toContain('bash-only');

		for (let index = 0; index < 30; index++) {
			store.store({
				text: `needle bulk-${index}\n${'x '.repeat(100)}`,
				tool_name: 'bulk',
			});
		}
		expect(store.search('needle', { limit: 100 })).toHaveLength(25);
	});

	it('escapes malformed and special-character FTS queries without throwing', () => {
		const store = create_store({ max_bytes: 10 });
		store.store({
			text: 'error in src/routes/+page.server.ts caused auth-middleware failure needle',
			tool_name: 'bash',
		});

		const queries = [
			'src/routes/+page.server.ts',
			'auth-middleware',
			'path:C:\\tmp\\demo',
			'foo -bar',
			'(alpha OR beta)',
			'"unterminated',
			'needle*',
			'',
			'./-:+',
		];
		for (const query of queries)
			expect(() => store.search(query)).not.toThrow();
		expect(escape_fts5_query('src/routes/+page.server.ts')).toContain(
			'"',
		);
		expect(escape_fts5_query('')).toBe('""');
	});

	it('purges by source id and cascades chunks plus FTS rows', () => {
		const store = create_store({ max_bytes: 10 });
		const stored = store.store({
			text: `purge-token\n${'x '.repeat(100)}`,
			tool_name: 'bash',
		});

		expect(store.purge({ source_id: stored!.source_id })).toBe(1);
		expect(store.get(stored!.source_id)).toEqual([]);
		expect(store.search('purge-token')).toEqual([]);
		expect(store.purge({ source_id: stored!.source_id })).toBe(0);
	});

	it('purges old sources by age without deleting fresh sources', () => {
		const store = create_store({ max_bytes: 10 });
		const old_source = store.store({
			text: `ancient-token\n${'a '.repeat(100)}`,
			tool_name: 'bash',
		});
		const fresh_source = store.store({
			text: `fresh-token\n${'b '.repeat(100)}`,
			tool_name: 'bash',
		});

		const db = new DatabaseSync(store.db_path, {
			enableForeignKeyConstraints: true,
		});
		try {
			db.prepare(
				'UPDATE context_sources SET created_at = ? WHERE id = ?',
			).run(
				Date.now() - 30 * 24 * 60 * 60 * 1000,
				old_source!.source_id,
			);
		} finally {
			close_db(db);
		}

		expect(store.purge({ older_than_days: 14 })).toBe(1);
		expect(store.get(old_source!.source_id)).toEqual([]);
		expect(store.get(fresh_source!.source_id)).toHaveLength(
			fresh_source!.chunk_count,
		);
		expect(store.search('ancient-token')).toEqual([]);
		expect(store.search('fresh-token')).toHaveLength(1);
	});

	it('reports zero content stats for a new database', () => {
		const store = create_store();
		const stats = store.stats();
		expect(stats).toMatchObject({
			sources: 0,
			chunks: 0,
			bytes_stored: 0,
			bytes_returned: 0,
			bytes_saved: 0,
			reduction_pct: 0,
		});
		expect(stats.total_bytes).toBeGreaterThan(0);
	});

	it('initializes expected schema objects and includes schema in package builds', () => {
		const store = create_store();
		const db = new DatabaseSync(store.db_path, {
			enableForeignKeyConstraints: true,
		});
		try {
			const objects = db
				.prepare(
					`SELECT type, name FROM sqlite_master ORDER BY type, name`,
				)
				.all() as Array<{ type: string; name: string }>;
			const names = objects.map((object) => object.name);
			expect(names).toContain('context_sources');
			expect(names).toContain('context_chunks');
			expect(names).toContain('context_chunks_fts');
			expect(names).toContain('context_chunks_ai');
			expect(names).toContain('context_chunks_ad');
			expect(names).toContain('context_chunks_au');
			expect(
				objects.some(
					(object) =>
						object.type === 'index' &&
						object.name === 'idx_context_chunks_source',
				),
			).toBe(true);
			expect(db.prepare('PRAGMA user_version').get()).toMatchObject({
				user_version: 1,
			});
		} finally {
			close_db(db);
		}

		const built_schema = new URL(
			'../dist/schema.sql',
			import.meta.url,
		);
		expect(existsSync(built_schema)).toBe(true);
		expect(readFileSync(built_schema, 'utf8')).toContain(
			'CREATE TABLE IF NOT EXISTS context_sources',
		);
	});
});

describe('global context store helpers', () => {
	it('respects enablement and reuses the configured db path', () => {
		const db_path = temp_db();
		expect(
			maybe_store_context_output({
				text: 'x '.repeat(100),
				tool_name: 'bash',
			}),
		).toBeNull();

		set_context_sidecar_enabled(true, { db_path, max_bytes: 10 });
		const stored = maybe_store_context_output({
			text: `global-token\n${'x '.repeat(100)}`,
			tool_name: 'bash',
		});
		expect(stored?.source_id).toMatch(/^ctx_/);
		expect(get_context_store().db_path).toBe(db_path);
		expect(get_context_store().search('global-token')).toHaveLength(
			1,
		);
	});

	it('builds the default db path from env overrides', () => {
		const original_db = process.env.MY_PI_CONTEXT_DB;
		const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.MY_PI_CONTEXT_DB = '/tmp/custom-context.db';
			expect(default_context_db_path()).toBe(
				'/tmp/custom-context.db',
			);

			delete process.env.MY_PI_CONTEXT_DB;
			process.env.PI_CODING_AGENT_DIR = '/tmp/pi-agent-test';
			expect(default_context_db_path()).toBe(
				'/tmp/pi-agent-test/context.db',
			);
		} finally {
			if (original_db === undefined)
				delete process.env.MY_PI_CONTEXT_DB;
			else process.env.MY_PI_CONTEXT_DB = original_db;
			if (original_agent_dir === undefined)
				delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
		}
	});
});

describe('should_index_text', () => {
	it('uses byte and line thresholds strictly above the limit', () => {
		expect(
			should_index_text('tiny', { max_bytes: 10, max_lines: 10 }),
		).toBe(false);
		expect(
			should_index_text('x'.repeat(10), {
				max_bytes: 10,
				max_lines: 10,
			}),
		).toBe(false);
		expect(
			should_index_text('x'.repeat(11), {
				max_bytes: 10,
				max_lines: 10,
			}),
		).toBe(true);
		expect(
			should_index_text('a\nb', { max_bytes: 100, max_lines: 2 }),
		).toBe(false);
		expect(
			should_index_text('a\nb\nc', { max_bytes: 100, max_lines: 2 }),
		).toBe(true);
	});
});
