export type ObservabilityEventType =
	| 'session_start'
	| 'session_shutdown'
	| 'session_info_changed'
	| 'agent_start'
	| 'agent_end'
	| 'turn_start'
	| 'turn_end'
	| 'message_start'
	| 'message_end'
	| 'tool_call'
	| 'tool_result'
	| 'tool_execution_start'
	| 'tool_execution_update'
	| 'tool_execution_end'
	| 'model_select'
	| 'provider_request'
	| 'provider_response'
	| 'compaction'
	| 'branch_nav'
	| 'error'
	| 'custom';

export interface ObservabilityEvent<P = unknown> {
	event_id: string;
	ts: string;
	type: ObservabilityEventType;
	session_id: string;
	session_file?: string;
	cwd: string;
	agent_name?: string;
	session_name?: string;
	pool: string;
	tags: string[];
	provider?: string;
	model?: string;
	seq: number;
	payload: P;
}

export interface SessionInfo {
	session_id: string;
	session_file?: string;
	cwd: string;
	agent_name?: string;
	session_name?: string;
	pool: string;
	tags: string[];
	provider?: string;
	model?: string;
}

export interface DashboardSession extends SessionInfo {
	first_ts: string;
	last_ts: string;
	event_count: number;
}

export interface TraceSpanSummary {
	id: string;
	kind: string;
	name: string;
	start_ts: string;
	end_ts: string;
	duration_ms: number;
	error: boolean;
	event_count: number;
}

export interface ToolMetricsSummary {
	name: string;
	calls: number;
	errors: number;
	total_duration_ms: number;
	avg_duration_ms: number;
	max_duration_ms: number;
}

export interface TraceMetricsSummary {
	events: number;
	elapsed_ms: number;
	turns: number;
	tool_calls: number;
	tool_failures: number;
	/** @deprecated Use tool_calls. */
	tools: number;
	errors: number;
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	cost_usd: number;
	blocking_ms: number;
}

export interface TraceSummary {
	session: DashboardSession | null;
	spans: TraceSpanSummary[];
	tools: ToolMetricsSummary[];
	metrics: TraceMetricsSummary;
}

export interface ObservabilityConfig {
	server_url: string;
	token?: string;
	pool: string;
	tags: string[];
	agent_name?: string;
	raw_payloads: boolean;
	forward_session_id?: boolean;
	detail_level: 'summary' | 'detailed';
	max_payload_bytes: number;
	auto_start_server: boolean;
}

/** Aggregates over events with ts >= since (all retained events when null). */
export interface StatsTotals {
	sessions: number;
	turns: number;
	tool_calls: number;
	tool_errors: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	cost_usd: number;
	/** Assistant message durationMs percentiles; null when no message has one. */
	provider_p50_ms: number | null;
	provider_p95_ms: number | null;
}

/** One local calendar day (YYYY-MM-DD, server local time). */
export interface DailyStats {
	day: string;
	sessions: number;
	turns: number;
	tool_calls: number;
	tool_errors: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	cost_usd: number;
}

export interface ToolStats {
	name: string;
	calls: number;
	errors: number;
	total_ms: number;
	p50_ms: number;
	p95_ms: number;
	max_ms: number;
	updates: number;
}

export interface SessionStats extends DashboardSession {
	turns: number;
	tool_calls: number;
	tool_errors: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cost_usd: number;
}

export interface OverviewResponse {
	since: string | null;
	totals: StatsTotals;
	daily: DailyStats[];
	tools: ToolStats[];
	sessions: SessionStats[];
}

export interface TurnSpanRow {
	start_seq: number;
	turn_index: number | null;
	start_ts: string;
	end_ts: string;
	duration_ms: number;
	stop_reason: string | null;
	provider_ms: number | null;
	tool_ms: number | null;
	tool_calls: number;
	tool_errors: number;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cache_write_tokens: number | null;
	cost_usd: number | null;
}

export interface ToolSpanRow {
	tool_call_id: string;
	tool_name: string | null;
	start_ts: string;
	end_ts: string | null;
	duration_ms: number | null;
	is_error: number | null;
	update_count: number | null;
	error_text: string | null;
	exit_code: number | null;
	parent_tool_call_id: string | null;
}

export interface SessionSpansResponse {
	turns: TurnSpanRow[];
	tools: ToolSpanRow[];
}

export type TimelineSpanKind = 'run' | 'turn' | 'model' | 'tool';

/** One bar in the session trace. Times are ms from the first event. */
export interface TimelineSpan {
	id: string;
	kind: TimelineSpanKind;
	/** Run: prompt preview. Turn: "Turn n". Model: model id. Tool: name. */
	name: string;
	/** Tool: command, path, or query. Model: stop reason. */
	detail: string | null;
	start_ts: string;
	start_ms: number;
	end_ms: number;
	/** Pi's measured duration when reported, else end_ms - start_ms. */
	duration_ms: number;
	/** No end event yet: still running, or the session stopped. */
	open: boolean;
	error: boolean;
	error_text: string | null;
	exit_code: number | null;
	/** Row offset for tool calls that overlap within one parent. */
	lane: number;
	update_count: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cost_usd: number | null;
	/** Event seq numbers that make up this span, for the event drawer. */
	event_seqs: number[];
	children: TimelineSpan[];
}

export interface SessionTimeline {
	start_ts: string | null;
	end_ms: number;
	runs: TimelineSpan[];
}

/** A failed tool call or model call, newest first. */
export interface FailureRow {
	kind: 'tool' | 'model';
	session_id: string;
	session_name: string | null;
	agent_name: string | null;
	cwd: string | null;
	ts: string;
	/** Tool name, or the model id for a model failure. */
	name: string;
	/** Timeline span id for tool failures (tool:<call id>). */
	span_id: string | null;
	error_text: string | null;
	exit_code: number | null;
	duration_ms: number | null;
}
