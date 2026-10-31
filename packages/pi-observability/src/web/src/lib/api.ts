import type {
	DashboardSession,
	ObservabilityEvent,
	OverviewResponse,
	SessionSpansResponse,
	SessionStats,
	ToolStats,
	TraceSummary,
} from '../../../types';

export type DashboardEvent = ObservabilityEvent<
	Record<string, unknown>
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

async function get_json<T>(path: string): Promise<T> {
	return (await (await api_fetch(path)).json()) as T;
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
		get_json<OverviewResponse>(
			`/stats/overview${query({ since, limit })}`,
		),
	tools: (since: string | null) =>
		get_json<{ tools: ToolStats[] }>(
			`/stats/tools${query({ since })}`,
		),
	session_stats: (since: string | null, limit = 500) =>
		get_json<{ sessions: SessionStats[] }>(
			`/stats/sessions${query({ since, limit })}`,
		),
	sessions: (limit = 200) =>
		get_json<{ sessions: DashboardSession[] }>(
			`/sessions${query({ limit })}`,
		),
	trace: (id: string) =>
		get_json<TraceSummary>(`${session_path(id)}/trace`),
	spans: (id: string) =>
		get_json<SessionSpansResponse>(`${session_path(id)}/spans`),
	events: (id: string, limit = 1000) =>
		get_json<{ events: DashboardEvent[] }>(
			`${session_path(id)}/events${query({ limit })}`,
		),
};
