import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import type {
	ContextUsageSnapshot,
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
	const times = events.flatMap((event) => {
		const time = timestamp_ms(event.ts);

		return time ? [time] : [];
	});

	return times.length > 1
		? Math.max(...times) - Math.min(...times)
		: 0;
}

const payload_record_schema = v.fallback(
	v.pipe(
		v.looseObject({}),
		v.check((value) => !Array.isArray(value)),
	),
	{},
);

type PayloadRecord = v.InferOutput<typeof payload_record_schema>;

const number_schema = v.fallback(
	v.union([
		v.pipe(v.number(), v.finite()),
		v.pipe(v.string(), v.transform(Number), v.finite()),
	]),
	0,
);

function record_value(
	record: PayloadRecord,
	key: string,
): PayloadRecord {
	return v.parse(payload_record_schema, record[key]);
}

const text_schema = v.union([
	v.string(),
	v.pipe(v.union([v.number(), v.boolean()]), v.transform(String)),
]);

/** Whether a tool payload, or anything nested in it, reports a failure. */
const structured_error_schema: v.GenericSchema<unknown, boolean> =
	v.fallback(
		v.lazy(() =>
			v.pipe(
				v.looseObject({}),
				v.transform((record: PayloadRecord) => {
					const status = v.safeParse(
						v.pipe(v.string(), v.toLowerCase()),
						record.status,
					);

					return (
						record.isError === true ||
						record.error === true ||
						v.is(v.looseObject({}), record.error) ||
						(status.success &&
							['error', 'failed', 'failure'].includes(
								status.output,
							)) ||
						Object.values(record).some((child) =>
							v.parse(structured_error_schema, child),
						)
					);
				}),
			),
		),
		false,
	);

function tool_id(event: ObservabilityEvent): string {
	const payload = v.parse(payload_record_schema, event.payload);

	return v.parse(
		v.fallback(text_schema, ''),
		payload.toolCallId ?? payload.tool_call_id ?? payload.id,
	);
}

function tool_name(event: ObservabilityEvent): string {
	const payload = v.parse(payload_record_schema, event.payload);

	return v.parse(
		v.fallback(text_schema, 'unknown tool'),
		payload.toolName ?? payload.tool_name ?? payload.name,
	);
}

function event_has_error(event: ObservabilityEvent): boolean {
	return (
		event.type === 'error' ||
		v.parse(structured_error_schema, event.payload)
	);
}

type UsageMetrics = Pick<
	TraceMetricsSummary,
	'input_tokens' | 'output_tokens' | 'total_tokens' | 'cost_usd'
>;

function first_number(
	record: PayloadRecord,
	...keys: string[]
): number {
	for (const key of keys) {
		if (record[key] !== undefined)
			return v.parse(number_schema, record[key]);
	}

	return 0;
}

function add_usage(
	target: UsageMetrics,
	record: PayloadRecord,
): boolean {
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
	entry: PayloadRecord,
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
			const entry: PayloadRecord = JSON.parse(line);
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
		const payload = v.parse(payload_record_schema, event.payload);
		add_usage(
			totals,
			Object.keys(record_value(payload, 'message')).length
				? record_value(payload, 'message')
				: payload,
		);
	}

	return totals;
}

/** Latest native snapshot wins, including an explicit unavailable value. */
function latest_context_usage(
	events: ObservabilityEvent[],
): ContextUsageSnapshot | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]!;
		const payload = v.parse(payload_record_schema, event.payload);

		if (!Object.hasOwn(payload, 'contextUsage')) continue;
		const usage = record_value(payload, 'contextUsage');
		const context_window = usage.contextWindow;

		if (
			typeof context_window !== 'number' ||
			!Number.isFinite(context_window) ||
			context_window <= 0
		)
			return null;

		const tokens =
			typeof usage.tokens === 'number' &&
			Number.isFinite(usage.tokens) &&
			usage.tokens >= 0
				? usage.tokens
				: null;

		return {
			tokens,
			context_window,
			percent:
				tokens !== null &&
				typeof usage.percent === 'number' &&
				Number.isFinite(usage.percent) &&
				usage.percent >= 0
					? usage.percent
					: null,
			ts: event.ts,
			model: event.model ?? null,
		};
	}

	return null;
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
		context_usage: latest_context_usage(ascending),
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
