import type { DatabaseSync } from 'node:sqlite';
import { to_session_row } from './event-rows.js';
import type {
	DailyStats,
	OverviewResponse,
	SessionSpansResponse,
	SessionStats,
	StatsTotals,
	ToolSpanRow,
	ToolStats,
	TurnSpanRow,
} from './types.js';

type Row = Record<string, unknown>;

const SINCE_FILTER = '($since IS NULL OR ts >= $since)';

/** Returns a normalized ISO timestamp, or null for missing/invalid input. */
export function parse_since(
	value: string | null | undefined,
): string | null {
	if (!value) return null;
	const time = new Date(value);
	return Number.isNaN(time.valueOf()) ? null : time.toISOString();
}

function count(value: unknown): number {
	const number = Number(value ?? 0);
	return Number.isFinite(number) ? number : 0;
}

function nullable_number(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function nullable_text(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/** Nearest-rank percentile of an ascending array; 0 when empty. */
export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const AGGREGATE_COLUMNS = `
	SUM(type = 'turn_start') AS turns,
	SUM(type = 'tool_execution_end') AS tool_calls,
	SUM(type = 'tool_execution_end' AND is_error = 1) AS tool_errors,
	SUM(input_tokens) AS input_tokens,
	SUM(output_tokens) AS output_tokens,
	SUM(cache_read_tokens) AS cache_read_tokens,
	SUM(cache_write_tokens) AS cache_write_tokens,
	SUM(cost_usd) AS cost_usd
`;

export function create_stats_queries(db: DatabaseSync) {
	const totals_statement = db.prepare(`
		SELECT COUNT(DISTINCT session_id) AS sessions, ${AGGREGATE_COLUMNS}
		FROM events WHERE ${SINCE_FILTER}
	`);
	const provider_durations_statement = db.prepare(`
		SELECT duration_ms FROM events
		WHERE type = 'message_end' AND duration_ms IS NOT NULL AND ${SINCE_FILTER}
		ORDER BY duration_ms
	`);
	const daily_statement = db.prepare(`
		SELECT date(ts, 'localtime') AS day,
			COUNT(DISTINCT session_id) AS sessions, ${AGGREGATE_COLUMNS}
		FROM events WHERE ${SINCE_FILTER}
		GROUP BY day ORDER BY day
	`);
	const tool_spans_statement = db.prepare(`
		SELECT tool_name, duration_ms, is_error, update_count
		FROM tool_spans
		WHERE ($since IS NULL OR start_ts >= $since)
	`);
	const session_stats_statement = db.prepare(`
		SELECT s.*, agg.turns, agg.tool_calls, agg.tool_errors,
			agg.input_tokens, agg.output_tokens, agg.cache_read_tokens,
			agg.cost_usd
		FROM sessions s
		JOIN (
			SELECT session_id, ${AGGREGATE_COLUMNS}
			FROM events WHERE ${SINCE_FILTER}
			GROUP BY session_id
		) agg ON agg.session_id = s.session_id
		ORDER BY s.last_ts DESC
		LIMIT $limit
	`);
	const turn_spans_statement = db.prepare(`
		SELECT * FROM turn_spans WHERE session_id = $session_id
		ORDER BY start_seq
	`);
	const tool_span_rows_statement = db.prepare(`
		SELECT * FROM tool_spans WHERE session_id = $session_id
		ORDER BY start_ts
	`);

	function totals(since: string | null): StatsTotals {
		const row = (totals_statement.get({ since }) ?? {}) as Row;
		const durations = (
			provider_durations_statement.all({ since }) as Row[]
		).map((item) => count(item.duration_ms));
		return {
			sessions: count(row.sessions),
			turns: count(row.turns),
			tool_calls: count(row.tool_calls),
			tool_errors: count(row.tool_errors),
			input_tokens: count(row.input_tokens),
			output_tokens: count(row.output_tokens),
			cache_read_tokens: count(row.cache_read_tokens),
			cache_write_tokens: count(row.cache_write_tokens),
			cost_usd: count(row.cost_usd),
			provider_p50_ms: durations.length
				? percentile(durations, 50)
				: null,
			provider_p95_ms: durations.length
				? percentile(durations, 95)
				: null,
		};
	}

	function daily(since: string | null): DailyStats[] {
		return (daily_statement.all({ since }) as Row[]).map((row) => ({
			day: String(row.day),
			sessions: count(row.sessions),
			turns: count(row.turns),
			tool_calls: count(row.tool_calls),
			tool_errors: count(row.tool_errors),
			input_tokens: count(row.input_tokens),
			output_tokens: count(row.output_tokens),
			cache_read_tokens: count(row.cache_read_tokens),
			cache_write_tokens: count(row.cache_write_tokens),
			cost_usd: count(row.cost_usd),
		}));
	}

	function tool_stats(since: string | null): ToolStats[] {
		const groups = new Map<
			string,
			{
				durations: number[];
				calls: number;
				errors: number;
				updates: number;
			}
		>();
		for (const row of tool_spans_statement.all({ since }) as Row[]) {
			const name = nullable_text(row.tool_name) ?? 'unknown tool';
			const group = groups.get(name) ?? {
				durations: [],
				calls: 0,
				errors: 0,
				updates: 0,
			};
			group.calls += 1;
			group.errors += Number(count(row.is_error) === 1);
			group.updates += count(row.update_count);
			const duration = nullable_number(row.duration_ms);
			if (duration !== null) group.durations.push(duration);
			groups.set(name, group);
		}
		return [...groups.entries()]
			.map(([name, group]) => {
				const sorted = group.durations.sort((a, b) => a - b);
				return {
					name,
					calls: group.calls,
					errors: group.errors,
					total_ms: sorted.reduce((sum, value) => sum + value, 0),
					p50_ms: percentile(sorted, 50),
					p95_ms: percentile(sorted, 95),
					max_ms: sorted.at(-1) ?? 0,
					updates: group.updates,
				};
			})
			.sort((a, b) => b.total_ms - a.total_ms);
	}

	function session_stats(
		since: string | null,
		limit: number,
	): SessionStats[] {
		return (
			session_stats_statement.all({ since, limit }) as Row[]
		).map((row) => ({
			...to_session_row(row),
			turns: count(row.turns),
			tool_calls: count(row.tool_calls),
			tool_errors: count(row.tool_errors),
			input_tokens: count(row.input_tokens),
			output_tokens: count(row.output_tokens),
			cache_read_tokens: count(row.cache_read_tokens),
			cost_usd: count(row.cost_usd),
		}));
	}

	function overview(
		since: string | null,
		session_limit: number,
	): OverviewResponse {
		return {
			since,
			totals: totals(since),
			daily: daily(since),
			tools: tool_stats(since),
			sessions: session_stats(since, session_limit),
		};
	}

	function session_spans(session_id: string): SessionSpansResponse {
		const turns: TurnSpanRow[] = (
			turn_spans_statement.all({ session_id }) as Row[]
		).map((row) => ({
			start_seq: count(row.start_seq),
			turn_index: nullable_number(row.turn_index),
			start_ts: String(row.start_ts),
			end_ts: String(row.end_ts),
			duration_ms: count(row.duration_ms),
			stop_reason: nullable_text(row.stop_reason),
			provider_ms: nullable_number(row.provider_ms),
			tool_ms: nullable_number(row.tool_ms),
			tool_calls: count(row.tool_calls),
			tool_errors: count(row.tool_errors),
			input_tokens: nullable_number(row.input_tokens),
			output_tokens: nullable_number(row.output_tokens),
			cache_read_tokens: nullable_number(row.cache_read_tokens),
			cache_write_tokens: nullable_number(row.cache_write_tokens),
			cost_usd: nullable_number(row.cost_usd),
		}));
		const tools: ToolSpanRow[] = (
			tool_span_rows_statement.all({ session_id }) as Row[]
		).map((row) => ({
			tool_call_id: String(row.tool_call_id),
			tool_name: nullable_text(row.tool_name),
			start_ts: String(row.start_ts),
			end_ts: nullable_text(row.end_ts),
			duration_ms: nullable_number(row.duration_ms),
			is_error: nullable_number(row.is_error),
			update_count: nullable_number(row.update_count),
		}));
		return { turns, tools };
	}

	return {
		totals,
		daily,
		tool_stats,
		session_stats,
		overview,
		session_spans,
	};
}

export type StatsQueries = ReturnType<typeof create_stats_queries>;
