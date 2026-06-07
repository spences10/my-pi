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
