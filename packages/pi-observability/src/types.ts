export type ObservabilityEventType =
	| 'session_start'
	| 'session_shutdown'
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
	pool: string;
	tags: string[];
	provider?: string;
	model?: string;
}

export interface DashboardSession extends SessionInfo {
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

export interface TraceMetricsSummary {
	events: number;
	elapsed_ms: number;
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
	metrics: TraceMetricsSummary;
}

export interface ObservabilityConfig {
	server_url: string;
	token?: string;
	pool: string;
	tags: string[];
	agent_name?: string;
	raw_payloads: boolean;
	max_payload_bytes: number;
	auto_start_server: boolean;
}
