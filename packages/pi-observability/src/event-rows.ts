import type {
	DashboardSession,
	ObservabilityEvent,
} from './types.js';

function row_text(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

export function to_row_event(
	row: Record<string, unknown>,
): ObservabilityEvent {
	return {
		event_id: row_text(row.event_id, ''),
		session_id: row_text(row.session_id, ''),
		seq: Number(row.seq),
		ts: row_text(row.ts, ''),
		type: row.type as ObservabilityEvent['type'],
		cwd: '',
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		payload: JSON.parse(row_text(row.payload_json, '{}')),
	};
}

export function to_session_row(
	row: Record<string, unknown>,
): DashboardSession {
	return {
		session_id: row_text(row.session_id, ''),
		session_file: row_text(row.session_file, '') || undefined,
		cwd: row_text(row.cwd, ''),
		agent_name: row_text(row.agent_name, '') || undefined,
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		last_ts: row_text(row.last_ts, ''),
		event_count: Number(row.event_count),
	};
}

export function valid_event(
	value: unknown,
): value is ObservabilityEvent {
	if (!value || typeof value !== 'object') return false;
	const event = value as Partial<ObservabilityEvent>;
	return (
		typeof event.event_id === 'string' &&
		typeof event.session_id === 'string' &&
		Number.isInteger(event.seq) &&
		typeof event.ts === 'string' &&
		typeof event.type === 'string'
	);
}
