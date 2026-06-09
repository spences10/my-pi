import { SvelteMap } from 'svelte/reactivity';
import type {
	DashboardSession,
	ObservabilityEvent,
	TraceSummary,
} from '../../types';

type Event = ObservabilityEvent<Record<string, unknown>>;
type Session = DashboardSession;
type View = 'trace' | 'swimlane' | 'race';
type LabelMap = Record<string, string[]>;

const token = new URLSearchParams(location.search).get('token') || '';
const theme_key = 'pi-observability-theme';
const labels_key = 'pi-observability-labels';

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
	selected_view = $state<View>('trace');
	theme = $state<'dark' | 'light'>('dark');
	selected_event = $state<Event | null>(null);
	labels = $state.raw<LabelMap>({});
	label_input = $state('');
}

export const state = new DashboardState();

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

export function duration(ms = 0) {
	if (!ms) return '—';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
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
	state.theme =
		localStorage.getItem(theme_key) === 'light' ? 'light' : 'dark';
}

export function toggle_theme() {
	state.theme = state.theme === 'dark' ? 'light' : 'dark';
	localStorage.setItem(theme_key, state.theme);
}

export function read_labels() {
	try {
		state.labels = JSON.parse(
			localStorage.getItem(labels_key) || '{}',
		);
	} catch {
		state.labels = {};
	}
}

function save_labels(next: LabelMap) {
	state.labels = next;
	localStorage.setItem(labels_key, JSON.stringify(next));
}

export function add_label() {
	const value = state.label_input.trim();
	if (!value || !state.selected_id) return;
	save_labels({
		...state.labels,
		[state.selected_id]: [
			...(state.labels[state.selected_id] || []),
			value,
		],
	});
	state.label_input = '';
}

export function remove_label(index: number) {
	if (!state.selected_id) return;
	const next = [...(state.labels[state.selected_id] || [])];
	next.splice(index, 1);
	save_labels({ ...state.labels, [state.selected_id]: next });
}

export async function load_sessions() {
	const response = await fetch(api('/sessions'));
	const body = await response.json();
	state.sessions = body.sessions || [];
	if (!state.selected_id && state.sessions[0])
		await select_session(state.sessions[0].session_id);
}

export async function fetch_events(id: string) {
	const response = await fetch(
		api(`/sessions/${encodeURIComponent(id)}/events?limit=500`),
	);
	const body = await response.json();
	const loaded = (body.events || []) as Event[];
	event_cache.set(id, loaded);
	if (id === state.selected_id) state.events = loaded;
	return loaded;
}

export async function select_session(id: string) {
	state.selected_id = id;
	state.selected_event = null;
	const [loaded_events, trace_response] = await Promise.all([
		fetch_events(id),
		fetch(api(`/sessions/${encodeURIComponent(id)}/trace`)),
	]);
	state.events = loaded_events;
	state.trace = await trace_response.json();
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
	if (!state.selected_id || selected_reload_timer) return;
	selected_reload_timer = setTimeout(() => {
		selected_reload_timer = null;
		void select_session(state.selected_id);
	}, 350);
}

export function connect() {
	const source = new EventSource(api('/events/stream'));
	source.addEventListener('hello', () => (state.connected = true));
	source.addEventListener('event', (message) => {
		const event = JSON.parse(message.data) as Event;
		if (state.paused) return;
		const cached = event_cache.get(event.session_id) || [];
		if (!cached.some((item) => item.event_id === event.event_id)) {
			event_cache.set(
				event.session_id,
				[event, ...cached].slice(0, 500),
			);
			if (event.session_id === state.selected_id)
				state.events = event_cache.get(event.session_id) || [];
		}
		schedule_sessions_reload();
		if (event.session_id === state.selected_id)
			schedule_selected_reload();
	});
	source.onerror = () => {
		state.connected = false;
		source.close();
		setTimeout(connect, 1500);
	};
	return () => source.close();
}
