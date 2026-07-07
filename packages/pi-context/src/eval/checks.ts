import { with_sqlite_busy_retry } from '@spences10/pi-sqlite-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { format_get_result } from '../context-format.js';
import { ContextStore, should_index_text } from '../store.js';
import {
	PROJECT,
	SESSION,
	make_noise_lines,
	result_bytes,
} from './fixtures.js';
import { get_scenarios, search_scenarios } from './scenarios.js';
import type { EvalCaseResult, SeededSource } from './types.js';

export function run_search_evals(
	store: ContextStore,
	seeded: Map<string, SeededSource>,
	results: EvalCaseResult[],
): void {
	for (const scenario of search_scenarios) {
		const source = seeded.get(scenario.source);
		if (!source) throw new Error(`Missing source ${scenario.source}`);
		const search = store.search(scenario.query, {
			source_id: source.source_id,
			limit: scenario.limit,
		});
		const passed = search.some((result) =>
			result.content.includes(scenario.expect),
		);
		results.push({
			name: scenario.name,
			category: 'search',
			passed,
			description: scenario.description,
			detail: passed
				? `matched ${search[0]?.chunk_id ?? 'unknown chunk'}`
				: `no expected match for query ${JSON.stringify(scenario.query)} (${search.length} result(s))`,
			returned_bytes: result_bytes(search),
			result_count: search.length,
		});
	}
}

export function run_retrieval_evals(
	store: ContextStore,
	seeded: Map<string, SeededSource>,
	results: EvalCaseResult[],
): void {
	for (const scenario of get_scenarios) {
		const source = seeded.get(scenario.source);
		if (!source) throw new Error(`Missing source ${scenario.source}`);
		const chunks = store.get(source.source_id, scenario.chunk_id);
		const passed = chunks.some((chunk) =>
			chunk.content.includes(scenario.expect),
		);
		results.push({
			name: scenario.name,
			category: 'retrieval',
			passed,
			description: scenario.description,
			detail: passed
				? `retrieved ${chunks[0]?.id ?? scenario.chunk_id}`
				: `missing expected content via chunk_id ${scenario.chunk_id}`,
			returned_bytes: result_bytes(chunks),
			result_count: chunks.length,
		});
	}
}

export function run_lifecycle_evals(
	store: ContextStore,
	seeded: Map<string, SeededSource>,
	results: EvalCaseResult[],
): void {
	const source = seeded.get('staging-help');
	if (!source) throw new Error('Missing source staging-help');
	store.purge({ source_id: source.source_id, global: true });
	const chunks = store.get(source.source_id, undefined, {
		global: true,
	});
	const summary = store.chunk_summary(source.source_id, {
		global: true,
	});
	const text = format_get_result(
		source.source_id,
		undefined,
		chunks,
		summary,
	);
	const passed =
		chunks.length === 0 &&
		text.includes('was not found') &&
		text.includes('expired');
	results.push({
		name: 'missing-source-guidance',
		category: 'lifecycle',
		passed,
		description:
			'Expired receipt retrieval should distinguish a missing backing source from an empty result and give guidance.',
		detail: passed
			? 'missing source reports expiry/purge guidance'
			: 'missing source is currently indistinguishable from no data',
		returned_bytes: Buffer.byteLength(text, 'utf8'),
		result_count: chunks.length,
	});
}

export function run_capture_evals(results: EvalCaseResult[]): void {
	const large_text = 'x'.repeat(24 * 1024 + 1);
	const many_lines = Array.from({ length: 301 }, (_, index) =>
		String(index),
	).join('\n');
	const small_text = 'small output';
	const passed =
		should_index_text(large_text) &&
		should_index_text(many_lines) &&
		!should_index_text(small_text);
	results.push({
		name: 'capture-thresholds',
		category: 'capture',
		passed,
		description:
			'Oversized byte and line-count outputs should be captured while small outputs stay inline.',
		detail: passed
			? 'byte, line, and small-output thresholds behaved as expected'
			: 'capture threshold mismatch',
		returned_bytes: 0,
		result_count: 3,
	});
}

function store_db(store: ContextStore): DatabaseSync {
	return Reflect.get(store, 'db') as DatabaseSync;
}

export function run_retention_evals(
	store: ContextStore,
	results: EvalCaseResult[],
): void {
	const old = store.store({
		text: `old-retention-token\n${'o '.repeat(500)}`,
		tool_name: 'bash',
		force: true,
	});
	const fresh = store.store({
		text: `fresh-retention-token\n${'f '.repeat(500)}`,
		tool_name: 'bash',
		force: true,
	});
	if (!old || !fresh)
		throw new Error('Failed to seed retention eval');
	with_sqlite_busy_retry(
		() =>
			store_db(store)
				.prepare(
					'UPDATE context_sources SET created_at = ? WHERE id = ?',
				)
				.run(Date.now() - 10 * 24 * 60 * 60 * 1000, old.source_id),
		{ operation: 'Seed context retention eval' },
	);
	const cleanup = store.cleanup({
		retention_days: 7,
		purge_on_shutdown: false,
		max_mb: null,
		max_bytes: null,
	});
	const old_results = store.search('old-retention-token', {
		source_id: old.source_id,
		global: true,
	});
	const fresh_results = store.search('fresh-retention-token', {
		source_id: fresh.source_id,
		global: true,
	});
	const passed =
		cleanup.age_deleted >= 1 &&
		old_results.length === 0 &&
		fresh_results.length > 0;
	results.push({
		name: 'age-retention-cleanup',
		category: 'retention',
		passed,
		description:
			'Age cleanup should delete expired sources without deleting fresh sources.',
		detail: `age_deleted=${cleanup.age_deleted}; old=${old_results.length}; fresh=${fresh_results.length}`,
		returned_bytes: result_bytes([...old_results, ...fresh_results]),
		result_count: old_results.length + fresh_results.length,
	});
}

export function run_cost_evals(
	store: ContextStore,
	seeded: Map<string, SeededSource>,
	results: EvalCaseResult[],
): void {
	const source = seeded.get('chunk-boundary');
	if (!source) throw new Error('Missing source chunk-boundary');
	const search = store.search('alpha-token omega-token', {
		source_id: source.source_id,
		limit: 25,
	});
	const bytes = result_bytes(search);
	const passed = search.length > 0 && bytes <= 24 * 1024;
	results.push({
		name: 'bounded-relaxed-search-cost',
		category: 'cost',
		passed,
		description:
			'Relaxed search should recover useful chunks without dumping excessive context back inline.',
		detail: `results=${search.length}; returned_bytes=${bytes}; budget=24576`,
		returned_bytes: bytes,
		result_count: search.length,
	});
}

export function run_dedupe_evals(results: EvalCaseResult[]): void {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-dedupe-eval-'));
	const store = new ContextStore({
		db_path: join(dir, 'context.db'),
		project_path: PROJECT,
		session_id: `${SESSION}:a`,
	});
	try {
		const text = `shared-dedupe-token\n${make_noise_lines(40, 'dedupe')}`;
		const first = store.store({
			text,
			tool_name: 'read',
			session_id: `${SESSION}:a`,
			project_path: PROJECT,
			force: true,
		});
		const same_session = store.store({
			text,
			tool_name: 'read',
			session_id: `${SESSION}:a`,
			project_path: PROJECT,
			force: true,
		});
		const other_session = store.store({
			text,
			tool_name: 'read',
			session_id: `${SESSION}:b`,
			project_path: PROJECT,
			force: true,
		});
		if (!first || !same_session || !other_session)
			throw new Error('Failed to seed dedupe eval');

		const same_session_chunks = store.get(
			first.source_id,
			undefined,
			{
				session_id: `${SESSION}:a`,
				project_path: PROJECT,
			},
		);
		const same_session_passed =
			first.source_id === same_session.source_id &&
			same_session.deduped === true &&
			same_session_chunks.length === first.chunk_count;
		results.push({
			name: 'same-session-dedupe',
			category: 'dedupe',
			passed: same_session_passed,
			description:
				'Identical content in the same default retrieval scope should reuse the existing source.',
			detail: `first=${first.source_id}; duplicate=${same_session.source_id}; retrieved=${same_session_chunks.length}`,
			returned_bytes: result_bytes(same_session_chunks),
			result_count: same_session_chunks.length,
		});

		const other_session_chunks = store.get(
			other_session.source_id,
			undefined,
			{
				session_id: `${SESSION}:b`,
				project_path: PROJECT,
			},
		);
		const hidden_from_first_session = store.get(
			other_session.source_id,
			undefined,
			{
				session_id: `${SESSION}:a`,
				project_path: PROJECT,
			},
		);
		const stats = store.stats({ global: true });
		const cross_session_passed =
			other_session.source_id !== first.source_id &&
			other_session.deduped !== true &&
			stats.sources === 2 &&
			other_session_chunks.length === other_session.chunk_count &&
			hidden_from_first_session.length === 0;
		results.push({
			name: 'cross-session-dedupe-isolation',
			category: 'dedupe',
			passed: cross_session_passed,
			description:
				'Identical content across sessions should remain separately scoped and visible only from its own retrieval scope.',
			detail: `first=${first.source_id}; other=${other_session.source_id}; sources=${stats.sources}; other_retrieved=${other_session_chunks.length}; hidden=${hidden_from_first_session.length}`,
			returned_bytes: result_bytes([
				...other_session_chunks,
				...hidden_from_first_session,
			]),
			result_count: stats.sources,
		});
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
}
