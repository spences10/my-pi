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
}

export interface SessionSpansResponse {
	turns: TurnSpanRow[];
	tools: ToolSpanRow[];
}
