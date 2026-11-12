import * as v from 'valibot';
import type { JsonValue } from './json.js';

/** Query columns derived from an event payload at ingest. */
export interface EventColumns {
	turn_index: number | null;
	tool_call_id: string | null;
	tool_name: string | null;
	is_error: number | null;
	duration_ms: number | null;
	stop_reason: string | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cache_write_tokens: number | null;
	cost_usd: number | null;
	error_text: string | null;
	exit_code: number | null;
	parent_tool_call_id: string | null;
}

/** Column order used by the insert statement and the backfill. */
export const EVENT_COLUMN_NAMES = [
	'turn_index',
	'tool_call_id',
	'tool_name',
	'is_error',
	'duration_ms',
	'stop_reason',
	'input_tokens',
	'output_tokens',
	'cache_read_tokens',
	'cache_write_tokens',
	'cost_usd',
	'error_text',
	'exit_code',
	'parent_tool_call_id',
] as const satisfies ReadonlyArray<keyof EventColumns>;

const finite_or_null = v.fallback(
	v.nullable(v.pipe(v.number(), v.finite())),
	null,
);

const text_or_null = v.fallback(
	v.nullable(v.pipe(v.string(), v.nonEmpty())),
	null,
);

const usage_schema = v.fallback(
	v.object({
		input: finite_or_null,
		output: finite_or_null,
		cacheRead: finite_or_null,
		cacheWrite: finite_or_null,
		cost: v.fallback(v.object({ total: finite_or_null }), {
			total: null,
		}),
	}),
	{
		input: null,
		output: null,
		cacheRead: null,
		cacheWrite: null,
		cost: { total: null },
	},
);

const message_schema = v.fallback(
	v.object({
		role: v.fallback(v.optional(v.string()), undefined),
		stopReason: text_or_null,
		durationMs: finite_or_null,
		errorMessage: text_or_null,
		usage: usage_schema,
	}),
	{
		role: undefined,
		stopReason: null,
		durationMs: null,
		errorMessage: null,
		usage: v.getFallback(usage_schema),
	},
);

const payload_schema = v.object({
	turnIndex: finite_or_null,
	toolCallId: text_or_null,
	toolName: text_or_null,
	isError: v.fallback(v.optional(v.boolean()), undefined),
	durationMs: finite_or_null,
	stopReason: text_or_null,
	errorText: text_or_null,
	exitCode: finite_or_null,
	parentToolCallId: text_or_null,
	message: message_schema,
});

const empty_payload = v.parse(payload_schema, {});

export function derive_event_columns(
	type: string,
	payload: JsonValue,
): EventColumns {
	const parsed = v.safeParse(payload_schema, payload);
	const body = parsed.success ? parsed.output : empty_payload;
	const message = body.message;

	const stop_reason = message.stopReason ?? body.stopReason;

	let is_error: number | null;

	if (body.isError !== undefined) is_error = Number(body.isError);
	else is_error = stop_reason === 'error' ? 1 : null;
	// Usage is read from message_end only. turn_end repeats the same
	// assistant message, so reading both would count it twice.
	const usage = type === 'message_end' ? message.usage : null;

	return {
		turn_index: body.turnIndex,
		tool_call_id: body.toolCallId,
		tool_name: body.toolName,
		is_error,
		// toolResult messages repeat the tool duration; only assistant
		// messages carry provider latency.
		duration_ms:
			body.durationMs ??
			(message.role === 'assistant' ? message.durationMs : null),
		stop_reason,
		input_tokens: usage?.input ?? null,
		output_tokens: usage?.output ?? null,
		cache_read_tokens: usage?.cacheRead ?? null,
		cache_write_tokens: usage?.cacheWrite ?? null,
		cost_usd: usage?.cost.total ?? null,
		// Tool failures carry errorText; failed model calls carry the
		// provider's errorMessage on the assistant message.
		error_text:
			body.errorText ??
			(stop_reason === 'error' ? message.errorMessage : null),
		exit_code: body.exitCode,
		parent_tool_call_id: body.parentToolCallId,
	};
}

export function event_column_values(
	columns: EventColumns,
): Array<number | string | null> {
	return EVENT_COLUMN_NAMES.map((name) => columns[name]);
}
