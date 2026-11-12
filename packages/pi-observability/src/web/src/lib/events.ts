import {
	is_json_scalar,
	json_number,
	json_object,
	json_string,
	type JsonValue,
} from '../../../json';
import type { DashboardEvent } from './api.js';

export function payload_value(
	payload: Record<string, JsonValue> | undefined,
	path: string,
): JsonValue | undefined {
	return path
		.split('.')
		.reduce<JsonValue | undefined>(
			(value, key) =>
				Array.isArray(value)
					? value.find((_, index) => String(index) === key)
					: json_object(value)?.[key],
			payload,
		);
}

export function text_preview(
	value: JsonValue | undefined,
	limit = 220,
): string {
	if (value === null || value === undefined) return '';

	const text = is_json_scalar(value)
		? String(value)
		: JSON.stringify(value);

	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Human label for an event type: tool_execution_end -> Tool execution end. */
export function type_label(type: string): string {
	const text = type.replaceAll('_', ' ');

	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One line that says what the event is about. */
export function event_summary(event: DashboardEvent): string {
	const payload = event.payload ?? {};
	const tool = json_string(payload.toolName);

	if (tool !== undefined) {
		const input =
			payload_value(payload, 'input.command') ??
			payload_value(payload, 'input.path') ??
			payload_value(payload, 'args.command');

		return input ? `${tool} · ${text_preview(input, 140)}` : tool;
	}

	const message = json_string(payload_value(payload, 'message.role'));

	if (message !== undefined) {
		const stop = json_string(
			payload_value(payload, 'message.stopReason'),
		);

		return stop !== undefined ? `${message} · ${stop}` : message;
	}

	const prompt = json_string(payload.prompt);

	if (prompt !== undefined) return text_preview(prompt, 160);

	const reason = json_string(payload.reason);

	if (reason !== undefined) return reason;

	const turn_index = json_number(payload.turnIndex);

	if (turn_index !== undefined) return `turn ${turn_index}`;

	const status = json_number(payload.status);

	if (status !== undefined) return `HTTP ${status}`;

	return json_string(payload.name) ?? '';
}

function has_error_value(value: JsonValue | undefined): boolean {
	if (Array.isArray(value)) return value.some(has_error_value);
	const record = json_object(value);

	if (!record) return false;

	if (
		record.isError === true ||
		record.stopReason === 'error' ||
		json_string(record.status)?.toLowerCase() === 'error'
	)
		return true;

	return Object.values(record).some(has_error_value);
}

export function event_has_error(event: DashboardEvent): boolean {
	return event.type === 'error' || has_error_value(event.payload);
}

/**
 * Filters with free text plus `type:`, `tool:`, and `json:path=value`
 * terms, all of which must match.
 */
export function query_matches(
	event: DashboardEvent,
	query: string,
): boolean {
	const parts = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (!parts.length) return true;

	const text =
		`${event.type} ${event_summary(event)} ${JSON.stringify(event.payload)}`.toLowerCase();

	return parts.every((part) => {
		const [key = '', ...rest] = part.split(':');
		const value = rest.join(':');

		if (!value) return text.includes(part);

		if (key === 'type')
			return event.type.toLowerCase().includes(value);

		if (key === 'tool')
			return text_preview(event.payload?.toolName, 1_000)
				.toLowerCase()
				.includes(value);

		if (key === 'json') {
			const [path = '', expected = ''] = value.split('=');

			return text_preview(payload_value(event.payload, path), 10_000)
				.toLowerCase()
				.includes(expected);
		}

		return text.includes(part);
	});
}
