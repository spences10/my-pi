import { readFileSync } from 'node:fs';
import type {
	DashboardSession,
	ObservabilityEvent,
	ToolMetricsSummary,
	TraceMetricsSummary,
	TraceSpanSummary,
	TraceSummary,
} from './types.js';

function timestamp_ms(value: string | undefined): number {
	const time = new Date(value ?? '').valueOf();
	return Number.isNaN(time) ? 0 : time;
}

function duration_ms(events: ObservabilityEvent[]): number {
	const times = events
		.map((event) => timestamp_ms(event.ts))
		.filter(Boolean);
	return times.length > 1
		? Math.max(...times) - Math.min(...times)
		: 0;
}

function number_value(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value))
		return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function record_value(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const value = record[key];
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text_value(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return fallback;
}

function tool_id(event: ObservabilityEvent): string {
	const payload = (event.payload ?? {}) as Record<string, unknown>;
	return text_value(
		payload.toolCallId ?? payload.tool_call_id ?? payload.id,
	);
}

function tool_name(event: ObservabilityEvent): string {
	const payload = (event.payload ?? {}) as Record<string, unknown>;
	return text_value(
		payload.toolName ?? payload.tool_name ?? payload.name,
		'unknown tool',
	);
}

function has_structured_error(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (
		record.isError === true ||
		record.error === true ||
		(typeof record.error === 'object' && record.error !== null) ||
		(typeof record.status === 'string' &&
			['error', 'failed', 'failure'].includes(
				record.status.toLowerCase(),
			))
	)
		return true;
	return Object.values(record).some(has_structured_error);
}

function event_has_error(event: ObservabilityEvent): boolean {
	return (
		event.type === 'error' || has_structured_error(event.payload)
	);
}

type UsageMetrics = Pick<
	TraceMetricsSummary,
	'input_tokens' | 'output_tokens' | 'total_tokens' | 'cost_usd'
>;

function first_number(
	record: Record<string, unknown>,
	...keys: string[]
): number {
	for (const key of keys) {
		if (record[key] !== undefined) return number_value(record[key]);
	}
	return 0;
}

function add_usage(target: UsageMetrics, payload: unknown): boolean {
	if (!payload || typeof payload !== 'object') return false;
	const record = payload as Record<string, unknown>;
	const usage = record_value(record, 'usage');
	if (!Object.keys(usage).length) return false;
	const cost = record_value(usage, 'cost');
	const input = first_number(
		usage,
		'input',
		'input_tokens',
		'prompt_tokens',
	);
	const output = first_number(
		usage,
		'output',
		'output_tokens',
		'completion_tokens',
	);
	const cache_read = first_number(usage, 'cacheRead', 'cache_read');
	const cache_write = first_number(
		usage,
		'cacheWrite',
		'cache_write',
	);
	target.input_tokens += input;
	target.output_tokens += output;
	target.total_tokens += input + output + cache_read + cache_write;
	target.cost_usd += first_number(
		cost,
		'total',
		'total_cost',
		'cost_usd',
	);
	return true;
}

function add_entry_usage(
	totals: UsageMetrics,
	entry: Record<string, unknown>,
): boolean {
	if (entry.type === 'message') {
		const message = record_value(entry, 'message');
		if (message.role !== 'assistant' && message.role !== 'toolResult')
			return false;
		return add_usage(totals, message);
	}
	if (entry.type === 'compaction' || entry.type === 'branch_summary')
		return add_usage(totals, entry);
	return false;
}

function session_file_usage(
	session_file: string | undefined,
): UsageMetrics | null {
	if (!session_file) return null;
	const totals: UsageMetrics = {
		input_tokens: 0,
		output_tokens: 0,
		total_tokens: 0,
		cost_usd: 0,
	};
	try {
		let found_usage = false;
		for (const line of readFileSync(session_file, 'utf8').split(
			'\n',
		)) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as Record<string, unknown>;
			found_usage = add_entry_usage(totals, entry) || found_usage;
		}
		return found_usage ? totals : null;
	} catch {
		return null;
	}
}

function event_usage(events: ObservabilityEvent[]): UsageMetrics {
	const totals: UsageMetrics = {
		input_tokens: 0,
		output_tokens: 0,
		total_tokens: 0,
		cost_usd: 0,
	};
	for (const event of events) {
		if (event.type !== 'message_end') continue;
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		add_usage(
			totals,
			Object.keys(record_value(payload, 'message')).length
				? record_value(payload, 'message')
				: payload,
		);
	}
	return totals;
}

export function trace_summary(
	session: DashboardSession | null,
	events: ObservabilityEvent[],
): TraceSummary {
	const ascending = events.slice().sort((a, b) => a.seq - b.seq);
	const calls = new Map<
		string,
		{
			id: string;
			name: string;
			start?: ObservabilityEvent;
			end?: ObservabilityEvent;
			error: boolean;
			event_count: number;
		}
	>();

	for (const event of ascending) {
		if (!event.type.startsWith('tool')) continue;
		const id = tool_id(event);
		if (!id) continue;
		const call = calls.get(id) ?? {
			id,
			name: tool_name(event),
			error: false,
			event_count: 0,
		};
		if (call.name === 'unknown tool') call.name = tool_name(event);
		if (
			event.type === 'tool_execution_start' ||
			event.type === 'tool_call'
		)
			call.start ??= event;
		if (
			event.type === 'tool_execution_end' ||
			event.type === 'tool_result'
		)
			call.end = event;
		call.error ||= event_has_error(event);
		call.event_count += 1;
		calls.set(id, call);
	}

	const tool_metrics = new Map<string, ToolMetricsSummary>();
	const spans: TraceSpanSummary[] = [];
	for (const call of calls.values()) {
		const duration =
			call.start && call.end
				? Math.max(
						0,
						timestamp_ms(call.end.ts) - timestamp_ms(call.start.ts),
					)
				: 0;
		const metrics = tool_metrics.get(call.name) ?? {
			name: call.name,
			calls: 0,
			errors: 0,
			total_duration_ms: 0,
			avg_duration_ms: 0,
			max_duration_ms: 0,
		};
		metrics.calls += 1;
		metrics.errors += Number(call.error);
		metrics.total_duration_ms += duration;
		metrics.max_duration_ms = Math.max(
			metrics.max_duration_ms,
			duration,
		);
		tool_metrics.set(call.name, metrics);
		if (call.start && call.end) {
			spans.push({
				id: `tool:${call.id}`,
				kind: 'tool',
				name: call.name,
				start_ts: call.start.ts,
				end_ts: call.end.ts,
				duration_ms: duration,
				error: call.error,
				event_count: call.event_count,
			});
		}
	}

	const tools = [...tool_metrics.values()]
		.map((tool) => ({
			...tool,
			avg_duration_ms: tool.calls
				? tool.total_duration_ms / tool.calls
				: 0,
		}))
		.sort((a, b) => b.total_duration_ms - a.total_duration_ms);
	spans.sort((a, b) => b.duration_ms - a.duration_ms);
	const usage =
		session_file_usage(session?.session_file) ?? event_usage(events);
	const tool_failures = [...calls.values()].filter(
		(call) => call.error,
	).length;
	return {
		session,
		spans: spans.slice(0, 80),
		tools,
		metrics: {
			events: events.length,
			elapsed_ms: duration_ms(events),
			turns: events.filter((event) => event.type === 'turn_start')
				.length,
			tool_calls: calls.size,
			tool_failures,
			tools: calls.size,
			errors:
				tool_failures +
				events.filter((event) => event.type === 'error').length,
			...usage,
			blocking_ms: spans.reduce(
				(sum, span) => sum + span.duration_ms,
				0,
			),
		},
	};
}
