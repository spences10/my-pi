import type { DashboardEvent } from './api.js';

/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type -- Generic path inspection leaves arbitrary payload values unvalidated. */
export function payload_value(
	payload: Record<string, unknown> | undefined,
	path: string,
): unknown {
	return path.split('.').reduce<unknown>((value, key) => {
		if (!value || typeof value !== 'object') return undefined;

		// SAFETY: The guard excludes null and primitives; property values remain unknown.
		return (value as Record<string, unknown>)[key];
	}, payload);
}

/* oxlint-enable anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type */

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Previewing arbitrary payloads is this helper's contract.
export function text_preview(value: unknown, limit = 220): string {
	if (value == null) return '';
	let text: string;

	if (typeof value === 'string') text = value;
	else if (typeof value === 'number' || typeof value === 'boolean')
		text = String(value);
	else text = JSON.stringify(value);

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
	const tool = payload.toolName;

	if (typeof tool === 'string') {
		const input =
			payload_value(payload, 'input.command') ??
			payload_value(payload, 'input.path') ??
			payload_value(payload, 'args.command');

		return input ? `${tool} · ${text_preview(input, 140)}` : tool;
	}

	const message = payload_value(payload, 'message.role');

	if (typeof message === 'string') {
		const stop = payload_value(payload, 'message.stopReason');

		return typeof stop === 'string'
			? `${message} · ${stop}`
			: message;
	}

	if (typeof payload.prompt === 'string')
		return text_preview(payload.prompt, 160);

	if (typeof payload.reason === 'string') return payload.reason;

	if (typeof payload.turnIndex === 'number')
		return `turn ${payload.turnIndex}`;

	if (typeof payload.status === 'number')
		return `HTTP ${payload.status}`;

	if (typeof payload.name === 'string') return payload.name;

	return '';
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Recursively inspect arbitrary external payloads without claiming a domain schema. */
function has_error_value(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: The guard excludes null and primitives; every property remains unknown.
	const record = value as Record<string, unknown>;

	if (
		record.isError === true ||
		record.stopReason === 'error' ||
		(typeof record.status === 'string' &&
			record.status.toLowerCase() === 'error')
	)
		return true;

	return Object.values(record).some(has_error_value);
}

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type */

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
