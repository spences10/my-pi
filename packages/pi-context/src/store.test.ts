import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ContextStore,
	escape_fts5_query,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';

let dirs: string[] = [];

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

afterEach(() => {
	set_context_sidecar_enabled(false);
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

describe('ContextStore', () => {
	it('stores oversized output, searches it, and retrieves exact chunks', () => {
		const store = new ContextStore({
			db_path: temp_db(),
			max_bytes: 10,
		});
		const stored = store.store({
			text: `alpha\n${'noise '.repeat(2000)}\nneedle-at-end`,
			tool_name: 'bash',
		});

		expect(stored?.source_id).toMatch(/^ctx_/);
		expect(stored?.receipt).toContain('context-sidecar');
		expect(stored?.receipt).toContain('context_search');

		const results = store.search('needle', {
			source_id: stored!.source_id,
		});
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].content).toContain('needle-at-end');

		const chunks = store.get(stored!.source_id);
		expect(chunks.map((chunk) => chunk.content).join('\n')).toContain(
			'needle-at-end',
		);

		const stats = store.stats();
		expect(stats.sources).toBe(1);
		expect(stats.chunks).toBeGreaterThan(0);
		expect(stats.bytes_stored).toBeGreaterThan(stats.bytes_returned);
	});

	it('passes through small output unless forced', () => {
		const store = new ContextStore({
			db_path: temp_db(),
			max_bytes: 1000,
		});
		expect(
			store.store({ text: 'small', tool_name: 'read' }),
		).toBeNull();

		const forced = store.store({
			text: 'small secret_token=abc123456789',
			tool_name: 'read',
			force: true,
		});
		expect(forced).not.toBeNull();
		const chunks = store.get(forced!.source_id);
		expect(chunks[0].content).toContain('[REDACTED:');
	});

	it('escapes special-character FTS queries without throwing', () => {
		const store = new ContextStore({
			db_path: temp_db(),
			max_bytes: 10,
		});
		store.store({
			text: 'error in src/routes/+page.server.ts caused auth-middleware failure',
			tool_name: 'bash',
		});
		expect(() =>
			store.search('src/routes/+page.server.ts'),
		).not.toThrow();
		expect(escape_fts5_query('src/routes/+page.server.ts')).toContain(
			'"',
		);
	});

	it('purges by source id', () => {
		const store = new ContextStore({
			db_path: temp_db(),
			max_bytes: 10,
		});
		const stored = store.store({
			text: 'x '.repeat(100),
			tool_name: 'bash',
		});
		expect(store.purge({ source_id: stored!.source_id })).toBe(1);
		expect(store.get(stored!.source_id)).toEqual([]);
	});
});

describe('should_index_text', () => {
	it('uses byte and line thresholds', () => {
		expect(
			should_index_text('tiny', { max_bytes: 10, max_lines: 10 }),
		).toBe(false);
		expect(
			should_index_text('x'.repeat(20), {
				max_bytes: 10,
				max_lines: 10,
			}),
		).toBe(true);
		expect(
			should_index_text('a\nb\nc', { max_bytes: 100, max_lines: 2 }),
		).toBe(true);
	});
});
