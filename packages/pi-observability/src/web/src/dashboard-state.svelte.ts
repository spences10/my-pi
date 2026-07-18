import { SvelteMap } from 'svelte/reactivity';
import type {
	DashboardSession,
	ObservabilityEvent,
	TraceSummary,
} from '../../types';
import { number_crunch } from './number-crunch';
export { number_crunch } from './number-crunch';

type Event = ObservabilityEvent<Record<string, unknown>>;
type Session = DashboardSession;
type View = 'timeline' | 'waterfall' | 'events';

function read_fragment_token() {
	const fragment = new URLSearchParams(location.hash.slice(1));
	const token = fragment.get('token') || '';
	if (token)
		history.replaceState(
			null,
			'',
			`${location.pathname}${location.search}`,
		);
	return token;
}

const token = read_fragment_token();
const theme_key = 'pi-observability-theme';
const details_key = 'pi-observability-details-open';

class DashboardState {
	sessions = $state.raw<Session[]>([]);
	events = $state.raw<Event[]>([]);
	trace = $state.raw<TraceSummary | null>(null);
	selected_id = $state('');
	connected = $state(false);
	paused = $state(false);
	query = $state('');
	event_query = $state('');
	selected_type = $state('');
	selected_view = $state<View>('timeline');
	theme = $state<'dark' | 'light'>('dark');
	selected_event = $state<Event | null>(null);
	details_open = $state(true);
	live_seen = $state.raw<Record<string, number>>({});
}

export const dashboard_state = new DashboardState();

export const event_cache = new SvelteMap<string, Event[]>();

let session_reload_timer: ReturnType<typeof setTimeout> | null = null;
let selected_reload_timer: ReturnType<typeof setTimeout> | null =
	null;

async function api_fetch(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	if (token) headers.set('authorization', `Bearer ${token}`);
	const response = await fetch(path, { ...init, headers });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response;
}

export function label(session: Session) {
	return (session.agent_name || session.session_id).slice(0, 44);
}

export function session_title(session: Session) {
	if (session.agent_name) return session.agent_name;
	const file = session.session_file?.split('/').filter(Boolean).pop();
	if (file) return file.replace(/\.(jsonl?|ndjson)$/i, '');
	return repo_name(session) || session.session_id;
}

export function time(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? value
		: date.toLocaleTimeString();
}

export function money(value = 0) {
	if (!value) return '—';
	if (value < 1) return `$${value.toFixed(3)}`;
	return `$${number_crunch(value)}`;
}

export function duration(ms = 0) {
	if (!ms) return '—';
	if (ms < 1000) return `${number_crunch(Math.round(ms))}ms`;
	if (ms < 60_000) return `${number_crunch(ms / 1000)}s`;
	return `${number_crunch(Math.floor(ms / 60_000))}m ${number_crunch(Math.round((ms % 60_000) / 1000))}s`;
}

export function repo_name(session: Session) {
	const key = session.cwd || 'unknown project';
	return (
		key.replace(/\/+$/, '').split('/').filter(Boolean).pop() || key
	);
}

export function is_active_session(session: Session) {
	const live = dashboard_state.live_seen[session.session_id] || 0;
	const recent = new Date(session.last_ts).valueOf();
	const latest = Math.max(live, Number.isNaN(recent) ? 0 : recent);
	return Date.now() - latest < 90_000;
}

function text_value(value: unknown, fallback = '') {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	if (value == null) return fallback;
	return JSON.stringify(value);
}

export function payload_value(
	payload: Record<string, unknown> | undefined,
	path: string,
) {
	return path.split('.').reduce<unknown>((value, key) => {
		if (!value || typeof value !== 'object') return undefined;
		return (value as Record<string, unknown>)[key];
	}, payload);
}

export function text_preview(value: unknown, limit = 220) {
	if (typeof value === 'string')
		return value.length > limit ? `${value.slice(0, limit)}…` : value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	if (value == null) return '';
	const text = JSON.stringify(value);
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function summary(event: Event) {
	const payload = event.payload || {};
	const value =
		payload.tool_name ||
		payload.toolName ||
		payload.name ||
		payload.message ||
		payload.summary ||
		payload.error;
	return text_value(value, JSON.stringify(payload)).slice(0, 180);
}

export function query_matches(event: Event, query_text: string) {
	const parts = query_text.toLowerCase().split(/\s+/).filter(Boolean);
	if (!parts.length) return true;
	const text =
		`${event.type} ${summary(event)} ${JSON.stringify(event.payload)}`.toLowerCase();
	for (const part of parts) {
		const [key, ...rest] = part.split(':');
		const value = rest.join(':');
		if (!value) {
			if (!text.includes(key)) return false;
			continue;
		}
		if (key === 'type' && !event.type.toLowerCase().includes(value))
			return false;
		if (key === 'tool' && !text.includes(value)) return false;
		if (key === 'status' && !text.includes(value)) return false;
		if (key === 'json') {
			const [path, expected = ''] = value.split('=');
			if (
				!text_value(payload_value(event.payload, path))
					.toLowerCase()
					.includes(expected)
			)
				return false;
		}
		if (
			!['type', 'tool', 'status', 'json'].includes(key) &&
			!text.includes(part)
		)
			return false;
	}
	return true;
}

export function extract_artifacts(source_events: Event[]) {
	const items: { event: Event; value: string }[] = [];
	const seen = new Set<string>();
	for (const event of source_events) {
		const text = JSON.stringify(event.payload || {});
		const paths = [
			...text.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g),
		].map((match) => match[0]);
		const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
			(match) => match[0],
		);
		let event_matches = 0;
		for (const value of [...paths, ...urls]) {
			const key = `${event.event_id}:${value}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({ event, value });
			event_matches += 1;
			if (event_matches >= 4) break;
		}
	}
	return items;
}

export function read_theme() {
	dashboard_state.theme =
		localStorage.getItem(theme_key) === 'light' ? 'light' : 'dark';
}

export function toggle_theme() {
	dashboard_state.theme =
		dashboard_state.theme === 'dark' ? 'light' : 'dark';
	localStorage.setItem(theme_key, dashboard_state.theme);
}

export function read_details_setting() {
	dashboard_state.details_open =
		localStorage.getItem(details_key) !== 'closed';
}

export function toggle_details_open() {
	dashboard_state.details_open = !dashboard_state.details_open;
	localStorage.setItem(
		details_key,
		dashboard_state.details_open ? 'open' : 'closed',
	);
}

export async function load_sessions() {
	const response = await api_fetch('/sessions');
	const body = await response.json();
	dashboard_state.sessions = body.sessions || [];
	if (!dashboard_state.selected_id && dashboard_state.sessions[0])
		await select_session(dashboard_state.sessions[0].session_id);
}

function sync_selected_event(events: Event[]) {
	const selected_id = dashboard_state.selected_event?.event_id;
	if (!selected_id) return;
	dashboard_state.selected_event =
		events.find((event) => event.event_id === selected_id) ??
		dashboard_state.selected_event;
}

export async function fetch_events(id: string) {
	const response = await api_fetch(
		`/sessions/${encodeURIComponent(id)}/events?limit=500`,
	);
	const body = await response.json();
	const loaded = (body.events || []) as Event[];
	event_cache.set(id, loaded);
	if (id === dashboard_state.selected_id) {
		dashboard_state.events = loaded;
		sync_selected_event(loaded);
	}
	return loaded;
}

export async function select_session(id: string) {
	const previous_id = dashboard_state.selected_id;
	dashboard_state.selected_id = id;
	if (previous_id !== id) dashboard_state.selected_event = null;
	const [loaded_events, trace_response] = await Promise.all([
		fetch_events(id),
		api_fetch(`/sessions/${encodeURIComponent(id)}/trace`),
	]);
	dashboard_state.events = loaded_events;
	sync_selected_event(loaded_events);
	dashboard_state.trace = await trace_response.json();
}

function schedule_sessions_reload() {
	if (session_reload_timer) return;
	session_reload_timer = setTimeout(() => {
		session_reload_timer = null;
		void load_sessions();
	}, 1000);
}

function schedule_selected_reload() {
	if (!dashboard_state.selected_id || selected_reload_timer) return;
	selected_reload_timer = setTimeout(() => {
		selected_reload_timer = null;
		void select_session(dashboard_state.selected_id);
	}, 350);
}

function receive_event(event: Event) {
	dashboard_state.live_seen = {
		...dashboard_state.live_seen,
		[event.session_id]: Date.now(),
	};
	if (event.type === 'session_shutdown') {
		const next = { ...dashboard_state.live_seen };
		delete next[event.session_id];
		dashboard_state.live_seen = next;
	}
	if (dashboard_state.paused) return;
	const cached = event_cache.get(event.session_id) || [];
	if (!cached.some((item) => item.event_id === event.event_id)) {
		event_cache.set(
			event.session_id,
			[event, ...cached].slice(0, 500),
		);
		if (event.session_id === dashboard_state.selected_id) {
			dashboard_state.events =
				event_cache.get(event.session_id) || [];
			sync_selected_event(dashboard_state.events);
		}
	}
	schedule_sessions_reload();
	if (event.session_id === dashboard_state.selected_id)
		schedule_selected_reload();
}

function receive_frame(frame: string) {
	let type = 'message';
	const data: string[] = [];
	for (const line of frame.split(/\r?\n/)) {
		if (line.startsWith('event:')) type = line.slice(6).trim();
		if (line.startsWith('data:'))
			data.push(line.slice(5).trimStart());
	}
	if (type === 'hello') {
		dashboard_state.connected = true;
		return;
	}
	if (type === 'event' && data.length > 0)
		receive_event(JSON.parse(data.join('\n')) as Event);
}

async function consume_stream(signal: AbortSignal) {
	while (!signal.aborted) {
		try {
			const response = await api_fetch('/events/stream', { signal });
			const reader = response.body?.getReader();
			if (!reader) throw new Error('Missing event stream body');
			const decoder = new TextDecoder();
			let buffered = '';
			while (!signal.aborted) {
				const chunk = await reader.read();
				if (chunk.done) break;
				buffered += decoder.decode(chunk.value, { stream: true });
				const frames = buffered.split(/\r?\n\r?\n/);
				buffered = frames.pop() || '';
				for (const frame of frames) receive_frame(frame);
			}
		} catch {
			if (signal.aborted) return;
		} finally {
			dashboard_state.connected = false;
		}
		await new Promise((resolve_wait) =>
			setTimeout(resolve_wait, 1500),
		);
	}
}

export function connect() {
	const controller = new AbortController();
	void consume_stream(controller.signal);
	return () => controller.abort();
}
