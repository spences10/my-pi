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

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function number_or_null(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: null;
}

function text_or_null(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export function derive_event_columns(
	type: string,
	payload: unknown,
): EventColumns {
	const body = record(payload);
	const message = record(body.message);
	const stop_reason =
		text_or_null(message.stopReason) ?? text_or_null(body.stopReason);
	const is_error =
		typeof body.isError === 'boolean'
			? Number(body.isError)
			: stop_reason === 'error'
				? 1
				: null;
	// Usage is read from message_end only. turn_end repeats the same
	// assistant message, so reading both would count it twice.
	const usage = type === 'message_end' ? record(message.usage) : {};
	return {
		turn_index: number_or_null(body.turnIndex),
		tool_call_id: text_or_null(body.toolCallId),
		tool_name: text_or_null(body.toolName),
		is_error,
		// toolResult messages repeat the tool duration; only assistant
		// messages carry provider latency.
		duration_ms:
			number_or_null(body.durationMs) ??
			(message.role === 'assistant'
				? number_or_null(message.durationMs)
				: null),
		stop_reason,
		input_tokens: number_or_null(usage.input),
		output_tokens: number_or_null(usage.output),
		cache_read_tokens: number_or_null(usage.cacheRead),
		cache_write_tokens: number_or_null(usage.cacheWrite),
		cost_usd: number_or_null(record(usage.cost).total),
		// Tool failures carry errorText; failed model calls carry the
		// provider's errorMessage on the assistant message.
		error_text:
			text_or_null(body.errorText) ??
			(stop_reason === 'error'
				? text_or_null(message.errorMessage)
				: null),
		exit_code: number_or_null(body.exitCode),
		parent_tool_call_id: text_or_null(body.parentToolCallId),
	};
}

export function event_column_values(
	columns: EventColumns,
): Array<number | string | null> {
	return EVENT_COLUMN_NAMES.map((name) => columns[name]);
}
