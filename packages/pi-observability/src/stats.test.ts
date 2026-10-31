import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { prepare_db } from './db.js';
import {
	derive_event_columns,
	event_column_values,
} from './event-columns.js';
import {
	create_stats_queries,
	parse_since,
	percentile,
} from './stats.js';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

type Fixture = [string, string, Record<string, unknown>];

// Noon UTC keeps the local calendar day equal to the UTC day for
// time zones within ±11 hours.
const DAY_A = '2026-10-30T12:00';
const DAY_B = '2026-10-31T12:00';

const SESSION_1: Fixture[] = [
	[`${DAY_A}:00.000Z`, 'turn_start', { turnIndex: 0 }],
	[
		`${DAY_A}:01.000Z`,
		'tool_execution_start',
		{ toolCallId: 'c1', toolName: 'bash' },
	],
	[
		`${DAY_A}:01.100Z`,
		'tool_execution_end',
		{
			toolCallId: 'c1',
			toolName: 'bash',
			isError: false,
			durationMs: 100,
			updateCount: 2,
		},
	],
	[
		`${DAY_A}:02.000Z`,
		'tool_execution_start',
		{ toolCallId: 'c2', toolName: 'read' },
	],
	[
		`${DAY_A}:02.300Z`,
		'tool_execution_end',
		{
			toolCallId: 'c2',
			toolName: 'read',
			isError: true,
			durationMs: 300,
			updateCount: 0,
		},
	],
	[
		`${DAY_A}:03.000Z`,
		'message_end',
		{
			message: {
				role: 'assistant',
				durationMs: 1000,
				usage: {
					input: 10,
					output: 2,
					cacheRead: 5,
					cacheWrite: 1,
					cost: { total: 0.1 },
				},
			},
		},
	],
	[`${DAY_A}:04.000Z`, 'turn_end', { turnIndex: 0 }],
];

const SESSION_2: Fixture[] = [
	[`${DAY_B}:00.000Z`, 'turn_start', { turnIndex: 0 }],
	[
		`${DAY_B}:01.000Z`,
		'tool_execution_start',
		{ toolCallId: 'c3', toolName: 'bash' },
	],
	[
		`${DAY_B}:01.500Z`,
		'tool_execution_end',
		{
			toolCallId: 'c3',
			toolName: 'bash',
			isError: false,
			durationMs: 500,
		},
	],
	[
		`${DAY_B}:02.000Z`,
		'message_end',
		{ message: { role: 'toolResult', durationMs: 500 } },
	],
	[
		`${DAY_B}:05.000Z`,
		'message_end',
		{
			message: {
				role: 'assistant',
				durationMs: 3000,
				usage: { input: 20, output: 4, cost: { total: 0.2 } },
			},
		},
	],
	[`${DAY_B}:06.000Z`, 'turn_end', { turnIndex: 0 }],
];

function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'pi-observability-stats-'));
	dirs.push(dir);
	const { db, statements } = prepare_db(join(dir, 'events.db'));
	const insert = (session_id: string, fixtures: Fixture[]) => {
		fixtures.forEach(([ts, type, payload], seq) => {
			statements.insert_event.run(
				`${session_id}-${seq}`,
				session_id,
				seq,
				ts,
				type,
				'default',
				'[]',
				JSON.stringify(payload),
				'openai-codex',
				'gpt-test',
				...event_column_values(derive_event_columns(type, payload)),
			);
			statements.upsert_session.run(
				session_id,
				'default',
				null,
				null,
				`/repo/${session_id}`,
				null,
				'openai-codex',
				'gpt-test',
				ts,
				ts,
				'[]',
			);
		});
	};
	insert('s1', SESSION_1);
	insert('s2', SESSION_2);
	return { db, stats: create_stats_queries(db) };
}

describe('parse_since', () => {
	it('normalizes valid timestamps and rejects the rest', () => {
		expect(parse_since('2026-10-31')).toBe(
			'2026-10-31T00:00:00.000Z',
		);
		expect(parse_since('not a date')).toBeNull();
		expect(parse_since('')).toBeNull();
		expect(parse_since(null)).toBeNull();
	});
});

describe('percentile', () => {
	it('uses nearest rank and returns 0 for no values', () => {
		expect(percentile([], 50)).toBe(0);
		expect(percentile([100, 500], 50)).toBe(100);
		expect(percentile([100, 500], 95)).toBe(500);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
	});
});

describe('create_stats_queries', () => {
	it('totals events and provider latency across all sessions', () => {
		const { db, stats } = setup();
		try {
			expect(stats.totals(null)).toEqual({
				sessions: 2,
				turns: 2,
				tool_calls: 3,
				tool_errors: 1,
				input_tokens: 30,
				output_tokens: 6,
				cache_read_tokens: 5,
				cache_write_tokens: 1,
				cost_usd: expect.closeTo(0.3, 6),
				provider_p50_ms: 1000,
				provider_p95_ms: 3000,
			});
		} finally {
			db.close();
		}
	});

	it('returns null provider latency when no message has a duration', () => {
		const { db, stats } = setup();
		try {
			expect(stats.totals('2030-01-01T00:00:00.000Z')).toMatchObject({
				sessions: 0,
				turns: 0,
				cost_usd: 0,
				provider_p50_ms: null,
				provider_p95_ms: null,
			});
		} finally {
			db.close();
		}
	});

	it('groups daily rows by local day in ascending order', () => {
		const { db, stats } = setup();
		try {
			expect(stats.daily(null)).toEqual([
				expect.objectContaining({
					day: '2026-10-30',
					sessions: 1,
					turns: 1,
					tool_calls: 2,
					tool_errors: 1,
					input_tokens: 10,
				}),
				expect.objectContaining({
					day: '2026-10-31',
					sessions: 1,
					tool_calls: 1,
					tool_errors: 0,
					input_tokens: 20,
				}),
			]);
		} finally {
			db.close();
		}
	});

	it('computes tool percentiles and filters by since', () => {
		const { db, stats } = setup();
		try {
			expect(stats.tool_stats(null)).toEqual([
				{
					name: 'bash',
					calls: 2,
					errors: 0,
					total_ms: 600,
					p50_ms: 100,
					p95_ms: 500,
					max_ms: 500,
					updates: 2,
				},
				{
					name: 'read',
					calls: 1,
					errors: 1,
					total_ms: 300,
					p50_ms: 300,
					p95_ms: 300,
					max_ms: 300,
					updates: 0,
				},
			]);
			expect(
				stats.tool_stats('2026-10-31T00:00:00.000Z'),
			).toMatchObject([{ name: 'bash', calls: 1, total_ms: 500 }]);
		} finally {
			db.close();
		}
	});

	it('aggregates sessions newest first with a limit', () => {
		const { db, stats } = setup();
		try {
			const sessions = stats.session_stats(null, 10);
			expect(sessions.map((row) => row.session_id)).toEqual([
				's2',
				's1',
			]);
			expect(sessions[1]).toMatchObject({
				cwd: '/repo/s1',
				model: 'gpt-test',
				turns: 1,
				tool_calls: 2,
				tool_errors: 1,
				input_tokens: 10,
				output_tokens: 2,
				cache_read_tokens: 5,
				cost_usd: expect.closeTo(0.1, 6),
			});
			expect(stats.session_stats(null, 1)).toHaveLength(1);
			expect(
				stats
					.session_stats('2026-10-31T00:00:00.000Z', 10)
					.map((row) => row.session_id),
			).toEqual(['s2']);
		} finally {
			db.close();
		}
	});

	it('returns turn and tool spans for one session', () => {
		const { db, stats } = setup();
		try {
			const spans = stats.session_spans('s1');
			expect(spans.turns).toEqual([
				expect.objectContaining({
					start_seq: 0,
					turn_index: 0,
					provider_ms: 1000,
					tool_ms: 400,
					tool_calls: 2,
					tool_errors: 1,
					input_tokens: 10,
				}),
			]);
			expect(spans.tools).toEqual([
				expect.objectContaining({
					tool_call_id: 'c1',
					tool_name: 'bash',
					duration_ms: 100,
					is_error: 0,
					update_count: 2,
				}),
				expect.objectContaining({
					tool_call_id: 'c2',
					tool_name: 'read',
					is_error: 1,
				}),
			]);
			expect(stats.session_spans('missing')).toEqual({
				turns: [],
				tools: [],
			});
		} finally {
			db.close();
		}
	});

	it('combines everything in the overview', () => {
		const { db, stats } = setup();
		try {
			const overview = stats.overview(null, 1);
			expect(overview.since).toBeNull();
			expect(overview.totals.sessions).toBe(2);
			expect(overview.daily).toHaveLength(2);
			expect(overview.tools.map((tool) => tool.name)).toEqual([
				'bash',
				'read',
			]);
			expect(overview.sessions).toHaveLength(1);
		} finally {
			db.close();
		}
	});
});
