import type { JsonValue } from '../../../json';
import * as v from 'valibot';
import {
	events_response_schema,
	failures_response_schema,
	overview_response_schema,
	session_spans_response_schema,
	session_stats_response_schema,
	session_timeline_schema,
	sessions_response_schema,
	tools_response_schema,
	trace_summary_schema,
} from '../../../response-schemas';
import type { ObservabilityEvent } from '../../../types';

export type DashboardEvent = ObservabilityEvent<
	Record<string, JsonValue>
>;

// The dashboard URL carries the token in the fragment so it never
// reaches server logs. Read it once, then drop it from the address.
function read_fragment_token(): string {
	const fragment = new URLSearchParams(location.hash.slice(1));
	const token = fragment.get('token') ?? '';

	if (token)
		history.replaceState(
			null,
			'',
			`${location.pathname}${location.search}`,
		);

	return token;
}

const token = read_fragment_token();

export function has_token(): boolean {
	return token !== '';
}

export class ApiError extends Error {
	constructor(readonly status: number) {
		super(
			status === 401
				? 'The dashboard token was rejected. Open the link from /observability again.'
				: `The observability server returned HTTP ${status}.`,
		);
	}
}

export async function api_fetch(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);

	if (token) headers.set('authorization', `Bearer ${token}`);
	const response = await fetch(path, { ...init, headers });

	if (!response.ok) throw new ApiError(response.status);

	return response;
}

async function get_json<T>(
	path: string,
	schema: v.GenericSchema<unknown, T>,
): Promise<T> {
	return v.parse(schema, await (await api_fetch(path)).json());
}

function query(
	params: Record<string, string | number | null>,
): string {
	const search = new URLSearchParams();

	for (const [key, value] of Object.entries(params))
		if (value !== null && value !== '')
			search.set(key, String(value));
	const text = search.toString();

	return text ? `?${text}` : '';
}

const session_path = (id: string) =>
	`/sessions/${encodeURIComponent(id)}`;

export const api = {
	overview: (since: string | null, limit = 12) =>
		get_json(
			`/stats/overview${query({ since, limit })}`,
			overview_response_schema,
		),
	tools: (since: string | null) =>
		get_json(
			`/stats/tools${query({ since })}`,
			tools_response_schema,
		),
	session_stats: (since: string | null, limit = 500) =>
		get_json(
			`/stats/sessions${query({ since, limit })}`,
			session_stats_response_schema,
		),
	sessions: (limit = 200) =>
		get_json(
			`/sessions${query({ limit })}`,
			sessions_response_schema,
		),
	trace: (id: string) =>
		get_json(`${session_path(id)}/trace`, trace_summary_schema),
	spans: (id: string) =>
		get_json(
			`${session_path(id)}/spans`,
			session_spans_response_schema,
		),
	timeline: (id: string) =>
		get_json(`${session_path(id)}/timeline`, session_timeline_schema),
	failures: (since: string | null, limit = 50) =>
		get_json(
			`/stats/failures${query({ since, limit })}`,
			failures_response_schema,
		),
	/** Substring search over every stored event payload. */
	search_events: (q: string, limit = 12) =>
		get_json(
			`/events/search${query({ q, limit })}`,
			events_response_schema,
		),
	events: (id: string, limit = 1000) =>
		get_json(
			`${session_path(id)}/events${query({ limit })}`,
			events_response_schema,
		),
};
