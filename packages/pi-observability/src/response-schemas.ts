import * as v from 'valibot';
import { json_value_schema, type JsonValue } from './json.js';
import type {
	DailyStats,
	DashboardSession,
	FailureRow,
	ObservabilityEvent,
	OverviewResponse,
	SessionSpansResponse,
	SessionStats,
	SessionTimeline,
	StatsTotals,
	TimelineSpan,
	ToolSpanRow,
	ToolStats,
	TraceSummary,
	TurnSpanRow,
} from './types.js';
import { OBSERVABILITY_EVENT_TYPES } from './types.js';

/** Schemas for the JSON bodies the dashboard server returns. */

const nullable_string = v.nullable(v.string());
const nullable_number = v.nullable(v.number());

const dashboard_session_entries = {
	session_id: v.string(),
	session_file: v.optional(v.string()),
	cwd: v.string(),
	agent_name: v.optional(v.string()),
	session_name: v.optional(v.string()),
	pool: v.string(),
	tags: v.array(v.string()),
	provider: v.optional(v.string()),
	model: v.optional(v.string()),
	first_ts: v.string(),
	last_ts: v.string(),
	event_count: v.number(),
};

const dashboard_session_schema: v.GenericSchema<
	unknown,
	DashboardSession
> = v.object(dashboard_session_entries);

const stats_totals_schema: v.GenericSchema<unknown, StatsTotals> =
	v.object({
		sessions: v.number(),
		turns: v.number(),
		tool_calls: v.number(),
		tool_errors: v.number(),
		input_tokens: v.number(),
		output_tokens: v.number(),
		cache_read_tokens: v.number(),
		cache_write_tokens: v.number(),
		cost_usd: v.number(),
		provider_p50_ms: nullable_number,
		provider_p95_ms: nullable_number,
	});

const daily_stats_schema: v.GenericSchema<unknown, DailyStats> =
	v.object({
		day: v.string(),
		sessions: v.number(),
		turns: v.number(),
		tool_calls: v.number(),
		tool_errors: v.number(),
		input_tokens: v.number(),
		output_tokens: v.number(),
		cache_read_tokens: v.number(),
		cache_write_tokens: v.number(),
		cost_usd: v.number(),
	});

const tool_stats_schema: v.GenericSchema<unknown, ToolStats> =
	v.object({
		name: v.string(),
		calls: v.number(),
		errors: v.number(),
		total_ms: v.number(),
		p50_ms: v.number(),
		p95_ms: v.number(),
		max_ms: v.number(),
		updates: v.number(),
	});

const session_stats_schema: v.GenericSchema<unknown, SessionStats> =
	v.object({
		...dashboard_session_entries,
		turns: v.number(),
		tool_calls: v.number(),
		tool_errors: v.number(),
		input_tokens: v.number(),
		output_tokens: v.number(),
		cache_read_tokens: v.number(),
		cost_usd: v.number(),
	});

export const overview_response_schema: v.GenericSchema<
	unknown,
	OverviewResponse
> = v.object({
	since: nullable_string,
	totals: stats_totals_schema,
	daily: v.array(daily_stats_schema),
	tools: v.array(tool_stats_schema),
	sessions: v.array(session_stats_schema),
});

export const tools_response_schema = v.object({
	tools: v.array(tool_stats_schema),
});

export const session_stats_response_schema = v.object({
	sessions: v.array(session_stats_schema),
});

export const sessions_response_schema = v.object({
	sessions: v.array(dashboard_session_schema),
});

const turn_span_row_schema: v.GenericSchema<unknown, TurnSpanRow> =
	v.object({
		start_seq: v.number(),
		turn_index: nullable_number,
		start_ts: v.string(),
		end_ts: v.string(),
		interrupted: v.boolean(),
		duration_ms: v.number(),
		stop_reason: nullable_string,
		provider_ms: nullable_number,
		tool_ms: nullable_number,
		tool_calls: v.number(),
		tool_errors: v.number(),
		input_tokens: nullable_number,
		output_tokens: nullable_number,
		cache_read_tokens: nullable_number,
		cache_write_tokens: nullable_number,
		cost_usd: nullable_number,
	});

const tool_span_row_schema: v.GenericSchema<unknown, ToolSpanRow> =
	v.object({
		tool_call_id: v.string(),
		tool_name: nullable_string,
		start_ts: v.string(),
		end_ts: nullable_string,
		duration_ms: nullable_number,
		is_error: nullable_number,
		update_count: nullable_number,
		error_text: nullable_string,
		exit_code: nullable_number,
		parent_tool_call_id: nullable_string,
	});

export const session_spans_response_schema: v.GenericSchema<
	unknown,
	SessionSpansResponse
> = v.object({
	turns: v.array(turn_span_row_schema),
	tools: v.array(tool_span_row_schema),
});

export const trace_summary_schema: v.GenericSchema<
	unknown,
	TraceSummary
> = v.object({
	session: v.nullable(dashboard_session_schema),
	spans: v.array(
		v.object({
			id: v.string(),
			kind: v.string(),
			name: v.string(),
			start_ts: v.string(),
			end_ts: v.string(),
			duration_ms: v.number(),
			error: v.boolean(),
			event_count: v.number(),
		}),
	),
	tools: v.array(
		v.object({
			name: v.string(),
			calls: v.number(),
			errors: v.number(),
			total_duration_ms: v.number(),
			avg_duration_ms: v.number(),
			max_duration_ms: v.number(),
		}),
	),
	metrics: v.object({
		events: v.number(),
		elapsed_ms: v.number(),
		turns: v.number(),
		tool_calls: v.number(),
		tool_failures: v.number(),
		tools: v.number(),
		errors: v.number(),
		input_tokens: v.number(),
		output_tokens: v.number(),
		total_tokens: v.number(),
		cost_usd: v.number(),
		blocking_ms: v.number(),
	}),
	context_usage: v.nullable(
		v.object({
			tokens: nullable_number,
			context_window: v.number(),
			percent: nullable_number,
			ts: v.string(),
			model: nullable_string,
		}),
	),
});

const timeline_span_schema: v.GenericSchema<unknown, TimelineSpan> =
	v.object({
		id: v.string(),
		kind: v.picklist(['run', 'turn', 'model', 'tool']),
		name: v.string(),
		detail: nullable_string,
		requested_model: v.optional(v.string()),
		response_model: v.optional(v.string()),
		response_text: v.optional(v.string()),
		response_text_truncated: v.optional(v.boolean()),
		start_ts: v.string(),
		start_ms: v.number(),
		end_ms: v.number(),
		duration_ms: v.number(),
		open: v.boolean(),
		interrupted: v.optional(v.boolean()),
		error: v.boolean(),
		error_text: nullable_string,
		exit_code: nullable_number,
		lane: v.number(),
		update_count: nullable_number,
		input_tokens: nullable_number,
		output_tokens: nullable_number,
		cache_read_tokens: nullable_number,
		cost_usd: nullable_number,
		event_seqs: v.array(v.number()),
		children: v.array(v.lazy(() => timeline_span_schema)),
	});

export const session_timeline_schema: v.GenericSchema<
	unknown,
	SessionTimeline
> = v.object({
	start_ts: nullable_string,
	end_ms: v.number(),
	runs: v.array(timeline_span_schema),
});

const failure_row_schema: v.GenericSchema<unknown, FailureRow> =
	v.object({
		kind: v.picklist(['tool', 'model']),
		session_id: v.string(),
		session_name: nullable_string,
		agent_name: nullable_string,
		cwd: nullable_string,
		ts: v.string(),
		name: v.string(),
		span_id: nullable_string,
		error_text: nullable_string,
		exit_code: nullable_number,
		duration_ms: nullable_number,
	});

export const failures_response_schema = v.object({
	failures: v.array(failure_row_schema),
});

const json_object_schema = v.record(v.string(), json_value_schema);

const event_schema: v.GenericSchema<
	unknown,
	ObservabilityEvent<{ [key: string]: JsonValue }>
> = v.object({
	event_id: v.string(),
	ts: v.string(),
	type: v.picklist(OBSERVABILITY_EVENT_TYPES),
	session_id: v.string(),
	session_file: v.optional(v.string()),
	cwd: v.string(),
	agent_name: v.optional(v.string()),
	session_name: v.optional(v.string()),
	pool: v.string(),
	tags: v.array(v.string()),
	provider: v.optional(v.string()),
	model: v.optional(v.string()),
	seq: v.number(),
	payload: json_object_schema,
});

export const events_response_schema = v.object({
	events: v.array(event_schema),
});

/** One `event` frame of the live stream. */
export const stream_event_schema = event_schema;
