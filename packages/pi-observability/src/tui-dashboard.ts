import {
	getMarkdownTheme,
	type ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import {
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
} from '@earendil-works/pi-tui';
import { show_modal } from '@spences10/pi-tui-modal';
import { open_dashboard } from './index.js';

interface DashboardSession {
	session_id: string;
	pool?: string;
	agent_name?: string;
	cwd?: string;
	model?: string;
	provider?: string;
	last_ts?: string;
	event_count?: number;
	tags?: string[];
}

interface DashboardEvent {
	event_id: string;
	session_id: string;
	seq: number;
	ts: string;
	type: string;
	payload?: Record<string, unknown>;
}

interface DashboardSnapshot {
	sessions: DashboardSession[];
	events: Record<string, DashboardEvent[]>;
	loaded_at: Date;
}

function api_url(
	server_url: string,
	path: string,
	token?: string,
): string {
	const url = new URL(path, server_url.replace(/\/+$/, '') + '/');
	if (token) url.searchParams.set('token', token);
	return url.toString();
}

async function fetch_json<T>(
	server_url: string,
	path: string,
	token?: string,
): Promise<T> {
	const headers: Record<string, string> = {};
	if (token) headers.authorization = `Bearer ${token}`;
	const response = await fetch(api_url(server_url, path, token), {
		headers,
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return (await response.json()) as T;
}

async function fetch_observability_snapshot(
	server_url: string,
	token?: string,
	limit = 40,
): Promise<DashboardSnapshot> {
	const body = await fetch_json<{ sessions?: DashboardSession[] }>(
		server_url,
		`/sessions?limit=${limit}`,
		token,
	);
	const sessions = body.sessions ?? [];
	const selected = sessions.slice(0, 8);
	const pairs = await Promise.all(
		selected.map(async (session) => {
			const events_body = await fetch_json<{
				events?: DashboardEvent[];
			}>(
				server_url,
				`/sessions/${encodeURIComponent(session.session_id)}/events?limit=200`,
				token,
			);
			return [session.session_id, events_body.events ?? []] as const;
		}),
	);
	return {
		sessions,
		events: Object.fromEntries(pairs),
		loaded_at: new Date(),
	};
}

function short_id(session: DashboardSession): string {
	return (session.agent_name || session.session_id).slice(0, 32);
}

function project_name(cwd: string | undefined): string {
	if (!cwd) return 'unknown';
	return (
		cwd.replace(/\/+$/, '').split('/').filter(Boolean).pop() || cwd
	);
}

function age(ts: string | undefined): string {
	if (!ts) return '—';
	const ms = Date.now() - new Date(ts).valueOf();
	if (!Number.isFinite(ms) || ms < 0) return '—';
	if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
	return `${Math.round(ms / 3_600_000)}h ago`;
}

function event_counts(events: DashboardEvent[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const event of events)
		counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
	return counts;
}

function longest_gap(events: DashboardEvent[]): string {
	const ordered = events
		.slice()
		.reverse()
		.map((event) => ({
			...event,
			time: new Date(event.ts).valueOf(),
		}))
		.filter((event) => Number.isFinite(event.time));
	let best = 0;
	let label = '—';
	for (let index = 1; index < ordered.length; index++) {
		const gap = ordered[index].time - ordered[index - 1].time;
		if (gap > best) {
			best = gap;
			label = `${ordered[index - 1].type} → ${ordered[index].type}`;
		}
	}
	if (!best) return '—';
	return `${format_duration(best)} ${label}`;
}

function format_duration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.round(ms / 60_000)}m`;
}

function render_session_line(
	session: DashboardSession,
	selected: boolean,
	width: number,
): string {
	const marker = selected ? '›' : ' ';
	const active =
		Date.now() - new Date(session.last_ts ?? 0).valueOf() < 120_000;
	return truncateToWidth(
		`${marker} ${active ? '●' : '○'} ${short_id(session)} · ${project_name(session.cwd)} · ${session.pool ?? 'default'} · ${session.event_count ?? 0} events · ${age(session.last_ts)}`,
		width,
	);
}

function session_filter_text(session: DashboardSession): string {
	return [
		session.session_id,
		session.agent_name,
		session.pool,
		session.cwd,
		session.model,
		session.provider,
		...(session.tags ?? []),
	]
		.filter(Boolean)
		.join(' ');
}

function event_filter_text(event: DashboardEvent): string {
	return [
		event.type,
		event.seq,
		event.ts,
		JSON.stringify(event.payload ?? {}),
	]
		.filter(Boolean)
		.join(' ');
}

function render_filter_label(filter_text: string): string {
	return filter_text ? `Filter: ${filter_text}` : 'Type to filter';
}

function render_details(
	session: DashboardSession | undefined,
	events: DashboardEvent[],
	width: number,
): string[] {
	if (!session) return ['No sessions yet.'];
	const counts = event_counts(events);
	const top_types = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6)
		.map(([type, count]) => `${type}:${count}`)
		.join('  ');
	const errors = events.filter((event) =>
		JSON.stringify(event.payload ?? {})
			.toLowerCase()
			.includes('error'),
	).length;
	return [
		`Selected: ${short_id(session)}`,
		`Model: ${session.model || session.provider || 'unknown'}`,
		`Tags: ${(session.tags ?? []).join(', ') || 'none'}`,
		`Events loaded: ${events.length} · errors: ${errors}`,
		`Longest gap: ${longest_gap(events)}`,
		`Mix: ${top_types || 'none'}`,
	]
		.flatMap((line) => line.split('\n'))
		.map((line) => truncateToWidth(line, width));
}

export async function show_observability_tui_dashboard(
	ctx: ExtensionCommandContext,
	server_url: string,
	token?: string,
): Promise<void> {
	let snapshot = await fetch_observability_snapshot(
		server_url,
		token,
	);
	let selected = 0;
	let event_selected = 0;
	let payload_offset = 0;
	let view: 'sessions' | 'events' | 'event' = 'sessions';
	let filter_text = '';
	let refreshing = false;
	let status = `loaded ${snapshot.loaded_at.toLocaleTimeString()}`;

	function visible_sessions(): DashboardSession[] {
		return fuzzyFilter(
			snapshot.sessions,
			filter_text,
			session_filter_text,
		);
	}
	function selected_session(): DashboardSession | undefined {
		return visible_sessions()[selected];
	}
	function selected_events(): DashboardEvent[] {
		const session = selected_session();
		const events = session
			? (snapshot.events[session.session_id] ?? [])
			: [];
		return fuzzyFilter(events, filter_text, event_filter_text);
	}

	const search_input = new Input();
	const apply_search = (): void => {
		filter_text = search_input.getValue();
		selected = 0;
		event_selected = 0;
	};

	await show_modal<void>(
		ctx,
		{
			title: 'Observability dashboard',
			subtitle: () =>
				`${snapshot.sessions.length} sessions · ${status}`,
			footer: () => {
				if (view === 'sessions')
					return 'type to filter • ↑↓ select • enter details • ctrl+r refresh • q close';
				if (view === 'events')
					return 'type to filter • ↑↓ select event • enter payload • esc back';
				return '↑↓ scroll json • home/end jump • esc back • b browser';
			},
			overlay_options: { width: '90%', minWidth: 76 },
		},
		({ done }, theme, layout, tui) => {
			const refresh = async () => {
				if (refreshing) return;
				refreshing = true;
				status = 'refreshing…';
				tui.requestRender();
				try {
					snapshot = await fetch_observability_snapshot(
						server_url,
						token,
					);
					selected = Math.min(
						selected,
						Math.max(0, snapshot.sessions.length - 1),
					);
					status = `loaded ${snapshot.loaded_at.toLocaleTimeString()}`;
				} catch (error) {
					status =
						error instanceof Error ? error.message : 'refresh failed';
				} finally {
					refreshing = false;
					tui.requestRender();
				}
			};
			return {
				render: (width: number) => {
					const budget = layout.get_max_body_lines(width);
					if (view === 'events') {
						const events = selected_events();
						const session = selected_session();
						const lines = [
							theme.fg(
								'accent',
								`Session: ${session ? short_id(session) : 'none'}`,
							),
							render_filter_label(filter_text),
							...search_input.render(width),
							...render_details(session, events, width),
							'',
							theme.fg('accent', 'Recent events'),
						];
						const list_budget = Math.max(1, budget - lines.length);
						const start = Math.max(
							0,
							event_selected - Math.floor(list_budget / 2),
						);
						for (const [offset, event] of events
							.slice(start, start + list_budget)
							.entries()) {
							const index = start + offset;
							lines.push(
								truncateToWidth(
									`${index === event_selected ? '›' : ' '} #${event.seq} ${event.type} · ${age(event.ts)}`,
									width,
								),
							);
						}
						return lines.slice(0, budget);
					}
					if (view === 'event') {
						const event = selected_events()[event_selected];
						if (!event) return ['No event selected.'];
						const header = [
							theme.fg('accent', `#${event.seq} ${event.type}`),
							`Time: ${event.ts}`,
							'',
						];
						const markdown = new Markdown(
							`\`\`\`json\n${JSON.stringify(event.payload ?? {}, null, 2)}\n\`\`\``,
							0,
							0,
							getMarkdownTheme(),
						);
						const rendered = markdown.render(width);
						const body_budget = Math.max(
							1,
							budget - header.length - 1,
						);
						const max_offset = Math.max(
							0,
							rendered.length - body_budget,
						);
						payload_offset = Math.max(
							0,
							Math.min(payload_offset, max_offset),
						);
						const end = Math.min(
							payload_offset + body_budget,
							rendered.length,
						);
						const lines = [
							...header,
							...rendered.slice(payload_offset, end),
						];
						if (rendered.length > body_budget) {
							lines.push(
								theme.fg(
									'dim',
									truncateToWidth(
										`(${payload_offset + 1}-${end}/${rendered.length})`,
										width,
									),
								),
							);
						}
						return lines.map((line) => truncateToWidth(line, width));
					}
					const list_budget = Math.max(4, Math.floor(budget * 0.55));
					const start = Math.max(
						0,
						selected - Math.floor(list_budget / 2),
					);
					const sessions = visible_sessions();
					const visible = sessions.slice(start, start + list_budget);
					const lines = [
						theme.fg('accent', 'Sessions'),
						render_filter_label(filter_text),
						...search_input.render(width),
					];
					if (visible.length === 0) lines.push('  none');
					for (let index = 0; index < visible.length; index++) {
						const absolute = start + index;
						lines.push(
							render_session_line(
								visible[index],
								absolute === selected,
								width,
							),
						);
					}
					lines.push('', theme.fg('accent', 'Selected summary'));
					lines.push(
						...render_details(
							selected_session(),
							selected_events(),
							width,
						),
					);
					return lines.slice(0, budget);
				},
				invalidate: () => undefined,
				handleInput: (data: string) => {
					const keybindings = getKeybindings();
					if (
						keybindings.matches(data, 'tui.select.up') ||
						data === 'k'
					) {
						if (view === 'event')
							payload_offset = Math.max(0, payload_offset - 1);
						else if (view === 'events')
							event_selected = Math.max(0, event_selected - 1);
						else if (view === 'sessions')
							selected = Math.max(0, selected - 1);
					} else if (
						keybindings.matches(data, 'tui.select.down') ||
						data === 'j'
					) {
						if (view === 'event') payload_offset += 1;
						else if (view === 'events')
							event_selected = Math.min(
								Math.max(0, selected_events().length - 1),
								event_selected + 1,
							);
						else if (view === 'sessions')
							selected = Math.min(
								Math.max(0, visible_sessions().length - 1),
								selected + 1,
							);
					} else if (matchesKey(data, Key.home)) {
						if (view === 'event') payload_offset = 0;
					} else if (matchesKey(data, Key.end)) {
						if (view === 'event')
							payload_offset = Number.MAX_SAFE_INTEGER;
					} else if (matchesKey(data, Key.enter)) {
						if (view === 'sessions') {
							view = 'events';
							event_selected = 0;
						} else if (view === 'events') {
							view = 'event';
							payload_offset = 0;
						}
					} else if (matchesKey(data, Key.escape)) {
						if (view === 'event') view = 'events';
						else if (view === 'events') view = 'sessions';
						else done();
					} else if (matchesKey(data, Key.ctrl('r'))) {
						void refresh();
					} else if (view === 'event' && data === 'b') {
						open_dashboard(server_url);
					} else if (data === 'q') {
						done();
					} else if (view !== 'event') {
						const sanitized = data.replace(/ /g, '');
						if (!sanitized) return;
						search_input.handleInput(sanitized);
						apply_search();
					}
				},
			};
		},
	);
}
