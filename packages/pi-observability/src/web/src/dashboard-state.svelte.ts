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
type View = 'timeline' | 'waterfall' | 'events' | 'swimlane' | 'race';
export type SessionGroupBy = 'repo' | 'pool' | 'model';
export type SessionSortBy = 'recent' | 'events' | 'repo';
type LabelMap = Record<string, string[]>;

const token = new URLSearchParams(location.search).get('token') || '';
const theme_key = 'pi-observability-theme';
const labels_key = 'pi-observability-labels';
const pins_key = 'pi-observability-pins';
const archived_key = 'pi-observability-archived';

class DashboardState {
	sessions = $state.raw<Session[]>([]);
	events = $state.raw<Event[]>([]);
	trace = $state.raw<TraceSummary | null>(null);
	selected_id = $state('');
	connected = $state(false);
	paused = $state(false);
	query = $state('');
	group_by = $state<SessionGroupBy>('repo');
	sort_by = $state<SessionSortBy>('recent');
	show_archived = $state(false);
	event_query = $state('');
	selected_type = $state('');
	selected_view = $state<View>('timeline');
	theme = $state<'dark' | 'light'>('dark');
	selected_event = $state<Event | null>(null);
	labels = $state.raw<LabelMap>({});
	pinned = $state.raw<Record<string, true>>({});
	archived = $state.raw<Record<string, true>>({});
	live_seen = $state.raw<Record<string, number>>({});
	label_input = $state('');
}

export const dashboard_state = new DashboardState();

export const event_cache = new SvelteMap<string, Event[]>();

let session_reload_timer: ReturnType<typeof setTimeout> | null = null;
let selected_reload_timer: ReturnType<typeof setTimeout> | null =
	null;

export function api(path: string) {
	return `${path}${token ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ''}`;
}

export function label(session: Session) {
	return (session.agent_name || session.session_id).slice(0, 44);
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

function payload_path(
	payload: Record<string, unknown>,
	path: string,
) {
	return path.split('.').reduce<unknown>((value, key) => {
		if (!value || typeof value !== 'object') return undefined;
		return (value as Record<string, unknown>)[key];
	}, payload);
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
				!text_value(payload_path(event.payload, path))
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
	for (const event of source_events) {
		const text = JSON.stringify(event.payload || {});
		const paths = [
			...text.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g),
		].map((match) => match[0]);
		const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
			(match) => match[0],
		);
		for (const value of [...paths, ...urls].slice(0, 4))
			items.push({ event, value });
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

function read_record(key: string) {
	try {
		return JSON.parse(localStorage.getItem(key) || '{}') as Record<
			string,
			true
		>;
	} catch {
		return {};
	}
}

export function read_labels() {
	try {
		dashboard_state.labels = JSON.parse(
			localStorage.getItem(labels_key) || '{}',
		);
	} catch {
		dashboard_state.labels = {};
	}
	dashboard_state.pinned = read_record(pins_key);
	dashboard_state.archived = read_record(archived_key);
}

function save_labels(next: LabelMap) {
	dashboard_state.labels = next;
	localStorage.setItem(labels_key, JSON.stringify(next));
}

function save_record(key: string, next: Record<string, true>) {
	localStorage.setItem(key, JSON.stringify(next));
	return next;
}

export function toggle_pin(id: string) {
	const next = { ...dashboard_state.pinned };
	if (next[id]) delete next[id];
	else next[id] = true;
	dashboard_state.pinned = save_record(pins_key, next);
}

export function toggle_archive(id: string) {
	const next = { ...dashboard_state.archived };
	if (next[id]) delete next[id];
	else next[id] = true;
	dashboard_state.archived = save_record(archived_key, next);
}

export function toggle_query_token(token_value: string) {
	const parts = dashboard_state.query.split(/\s+/).filter(Boolean);
	dashboard_state.query = parts.includes(token_value)
		? parts.filter((part) => part !== token_value).join(' ')
		: [...parts, token_value].join(' ');
}

export function add_label() {
	const value = dashboard_state.label_input.trim();
	if (!value || !dashboard_state.selected_id) return;
	save_labels({
		...dashboard_state.labels,
		[dashboard_state.selected_id]: [
			...(dashboard_state.labels[dashboard_state.selected_id] || []),
			value,
		],
	});
	dashboard_state.label_input = '';
}

export function remove_label(index: number) {
	if (!dashboard_state.selected_id) return;
	const next = [
		...(dashboard_state.labels[dashboard_state.selected_id] || []),
	];
	next.splice(index, 1);
	save_labels({
		...dashboard_state.labels,
		[dashboard_state.selected_id]: next,
	});
}

export async function load_sessions() {
	const response = await fetch(api('/sessions'));
	const body = await response.json();
	dashboard_state.sessions = body.sessions || [];
	if (!dashboard_state.selected_id && dashboard_state.sessions[0])
		await select_session(dashboard_state.sessions[0].session_id);
}

export async function fetch_events(id: string) {
	const response = await fetch(
		api(`/sessions/${encodeURIComponent(id)}/events?limit=500`),
	);
	const body = await response.json();
	const loaded = (body.events || []) as Event[];
	event_cache.set(id, loaded);
	if (id === dashboard_state.selected_id)
		dashboard_state.events = loaded;
	return loaded;
}

export async function select_session(id: string) {
	dashboard_state.selected_id = id;
	dashboard_state.selected_event = null;
	const [loaded_events, trace_response] = await Promise.all([
		fetch_events(id),
		fetch(api(`/sessions/${encodeURIComponent(id)}/trace`)),
	]);
	dashboard_state.events = loaded_events;
	dashboard_state.trace = await trace_response.json();
}

export async function load_comparison(sessions: Session[]) {
	await Promise.all(
		sessions.map((session) => fetch_events(session.session_id)),
	);
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

export function connect() {
	const source = new EventSource(api('/events/stream'));
	source.addEventListener(
		'hello',
		() => (dashboard_state.connected = true),
	);
	source.addEventListener('event', (message) => {
		const event = JSON.parse(message.data) as Event;
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
			if (event.session_id === dashboard_state.selected_id)
				dashboard_state.events =
					event_cache.get(event.session_id) || [];
		}
		schedule_sessions_reload();
		if (event.session_id === dashboard_state.selected_id)
			schedule_selected_reload();
	});
	source.onerror = () => {
		dashboard_state.connected = false;
		source.close();
		setTimeout(connect, 1500);
	};
	return () => source.close();
}
