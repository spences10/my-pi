import type { SQLOutputValue } from 'node:sqlite';
import * as v from 'valibot';
import type {
	DashboardSession,
	ObservabilityEvent,
} from './types.js';

function row_text(
	value: SQLOutputValue | undefined,
	fallback: string,
): string {
	return typeof value === 'string' ? value : fallback;
}

export function to_row_event(
	row: Record<string, SQLOutputValue>,
): ObservabilityEvent {
	return {
		event_id: row_text(row.event_id, ''),
		session_id: row_text(row.session_id, ''),
		seq: Number(row.seq),
		ts: row_text(row.ts, ''),
		type: row.type as ObservabilityEvent['type'],
		cwd: '',
		session_name: row_text(row.session_name, '') || undefined,
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		payload: JSON.parse(row_text(row.payload_json, '{}')),
	};
}

export function to_session_row(
	row: Record<string, SQLOutputValue>,
): DashboardSession {
	return {
		session_id: row_text(row.session_id, ''),
		session_file: row_text(row.session_file, '') || undefined,
		cwd: row_text(row.cwd, ''),
		agent_name: row_text(row.agent_name, '') || undefined,
		session_name: row_text(row.session_name, '') || undefined,
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		first_ts: row_text(row.first_ts, ''),
		last_ts: row_text(row.last_ts, ''),
		event_count: Number(row.event_count),
	};
}

const valid_event_schema = v.looseObject({
	event_id: v.string(),
	session_id: v.string(),
	seq: v.pipe(v.number(), v.integer()),
	ts: v.string(),
	type: v.string(),
});

export function valid_event(
	value: unknown,
): value is ObservabilityEvent {
	return v.is(valid_event_schema, value);
}
