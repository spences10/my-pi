import { readFileSync } from 'node:fs';
import type {
	DashboardSession,
	ObservabilityEvent,
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

function walk_payload(
	value: unknown,
	visit: (record: Record<string, unknown>) => void,
): void {
	if (!value || typeof value !== 'object') return;
	visit(value as Record<string, unknown>);
	for (const item of Object.values(value)) walk_payload(item, visit);
}

function payload_text(event: ObservabilityEvent): string {
	return JSON.stringify(event.payload ?? {}).toLowerCase();
}

function text_value(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	if (value == null) return fallback;
	return JSON.stringify(value);
}

function span_name(event: ObservabilityEvent): string {
	const payload = (event.payload ?? {}) as Record<string, unknown>;
	return text_value(
		payload.tool_name ?? payload.toolName ?? payload.name,
		event.type,
	);
}

function session_file_usage(
	session_file: string | undefined,
): Pick<
	TraceMetricsSummary,
	'input_tokens' | 'output_tokens' | 'total_tokens' | 'cost_usd'
> {
	const empty = {
		input_tokens: 0,
		output_tokens: 0,
		total_tokens: 0,
		cost_usd: 0,
	};
	if (!session_file) return empty;
	try {
		const lines = readFileSync(session_file, 'utf8').split('\n');
		for (const line of lines) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as Record<string, unknown>;
			const message = record_value(entry, 'message');
			const usage = record_value(message, 'usage');
			const cost = record_value(usage, 'cost');
			empty.input_tokens += number_value(usage.input);
			empty.output_tokens += number_value(usage.output);
			empty.total_tokens += number_value(usage.totalTokens);
			empty.cost_usd += number_value(cost.total);
		}
		if (!empty.total_tokens)
			empty.total_tokens = empty.input_tokens + empty.output_tokens;
		return empty;
	} catch {
		return empty;
	}
}

export function trace_summary(
	session: DashboardSession | null,
	events: ObservabilityEvent[],
): TraceSummary {
	const ascending = events.slice().reverse();
	const spans = new Map<string, TraceSpanSummary>();
	let input_tokens = 0;
	let output_tokens = 0;
	let total_tokens = 0;
	let cost_usd = 0;

	for (const event of ascending) {
		walk_payload(event.payload, (record) => {
			const usage = record_value(record, 'usage');
			const cost = record_value(record, 'cost');
			input_tokens +=
				number_value(record.input_tokens) +
				number_value(record.prompt_tokens) +
				number_value(usage.input) +
				number_value(usage.input_tokens) +
				number_value(usage.prompt_tokens);
			output_tokens +=
				number_value(record.output_tokens) +
				number_value(record.completion_tokens) +
				number_value(usage.output) +
				number_value(usage.output_tokens) +
				number_value(usage.completion_tokens);
			total_tokens +=
				number_value(record.total_tokens) +
				number_value(usage.total_tokens) +
				number_value(usage.totalTokens);
			cost_usd +=
				number_value(record.total_cost) +
				number_value(record.cost_usd) +
				number_value(cost.total) +
				number_value(cost.total_cost) +
				number_value(cost.cost_usd);
		});
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		const id = text_value(
			payload.toolCallId ?? payload.tool_call_id ?? payload.id,
			`${event.type}:${event.seq}`,
		);
		const kind = event.type.includes('tool')
			? 'tool'
			: event.type.includes('provider')
				? 'provider'
				: event.type.includes('message')
					? 'message'
					: event.type.includes('turn')
						? 'turn'
						: 'event';
		const key =
			kind === 'event'
				? `${event.type}:${event.seq}`
				: `${kind}:${id}`;
		const span = spans.get(key) ?? {
			id: key,
			kind,
			name: span_name(event),
			start_ts: event.ts,
			end_ts: event.ts,
			duration_ms: 0,
			error: false,
			event_count: 0,
		};
		span.start_ts =
			timestamp_ms(event.ts) < timestamp_ms(span.start_ts)
				? event.ts
				: span.start_ts;
		span.end_ts =
			timestamp_ms(event.ts) > timestamp_ms(span.end_ts)
				? event.ts
				: span.end_ts;
		span.duration_ms = Math.max(
			0,
			timestamp_ms(span.end_ts) - timestamp_ms(span.start_ts),
		);
		span.error ||=
			event.type === 'error' || payload_text(event).includes('error');
		span.event_count += 1;
		spans.set(key, span);
	}
	if (!total_tokens) total_tokens = input_tokens + output_tokens;
	if (!total_tokens && !cost_usd) {
		const fallback = session_file_usage(session?.session_file);
		input_tokens = fallback.input_tokens;
		output_tokens = fallback.output_tokens;
		total_tokens = fallback.total_tokens;
		cost_usd = fallback.cost_usd;
	}
	const span_list = [...spans.values()]
		.filter((span) => span.kind !== 'event' || span.error)
		.sort((a, b) => b.duration_ms - a.duration_ms)
		.slice(0, 80);
	return {
		session,
		spans: span_list,
		metrics: {
			events: events.length,
			elapsed_ms: duration_ms(events),
			tools: span_list.filter((span) => span.kind === 'tool').length,
			errors: events.filter(
				(event) =>
					event.type === 'error' ||
					payload_text(event).includes('error'),
			).length,
			input_tokens,
			output_tokens,
			total_tokens,
			cost_usd,
			blocking_ms: span_list
				.filter(
					(span) => span.kind === 'tool' || span.kind === 'provider',
				)
				.reduce((sum, span) => sum + span.duration_ms, 0),
		},
	};
}
