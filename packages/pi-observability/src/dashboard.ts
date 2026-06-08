// @ts-nocheck
const token_value =
	new URLSearchParams(location.search).get('token') || '';
let selected_id = null;
let current_view = 'single';
let session_cache = [];
let paused = false;
let live_render_timer = null;
let session_reload_timer = null;
const event_cache = new Map();
const known_types = new Set();
const theme_key = 'pi-observability-theme';

function apply_theme(theme) {
	document.documentElement.dataset.theme = theme;
	theme_btn.textContent = theme === 'light' ? 'Dark' : 'Light';
	theme_btn.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`;
}
apply_theme(localStorage.getItem(theme_key) || 'dark');

function api(path) {
	return (
		path +
		(token_value
			? (path.includes('?') ? '&' : '?') +
				'token=' +
				encodeURIComponent(token_value)
			: '')
	);
}
function escape_html(value) {
	return String(value ?? '').replace(
		/[&<>]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c],
	);
}
function label_session(session) {
	return escape_html(
		(session.agent_name || session.session_id).slice(0, 48),
	);
}
function short_time(value) {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? escape_html(value)
		: date.toLocaleTimeString();
}
function elapsed_ms(events) {
	if (events.length < 2) return 0;
	const times = events
		.map((event) => new Date(event.ts).valueOf())
		.filter((value) => !Number.isNaN(value));
	return times.length < 2
		? 0
		: Math.max(...times) - Math.min(...times);
}
function format_duration(ms) {
	if (!ms) return '—';
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
function event_text(event) {
	return JSON.stringify(event.payload ?? {}).toLowerCase();
}
function summarize_value(value, limit = 160) {
	if (value == null) return '';
	if (typeof value === 'string') return value.slice(0, limit);
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return JSON.stringify(value).slice(0, limit);
}
function summarize_payload(event) {
	const payload = event.payload || {};
	if (payload.tool_name) return `tool: ${payload.tool_name}`;
	if (payload.name) return summarize_value(payload.name);
	if (payload.message) return summarize_value(payload.message);
	if (payload.error) return summarize_value(payload.error);
	if (payload.summary) return summarize_value(payload.summary);
	return summarize_value(payload, 180);
}

function label_storage_key() {
	return selected_id ? `pi-observability-labels:${selected_id}` : '';
}
function read_labels() {
	const key = label_storage_key();
	if (!key) return [];
	try {
		return JSON.parse(localStorage.getItem(key) || '[]');
	} catch {
		return [];
	}
}
function write_labels(labels) {
	const key = label_storage_key();
	if (key) localStorage.setItem(key, JSON.stringify(labels));
}
function render_labels() {
	const labels = read_labels();
	label_list.innerHTML = labels
		.map(
			(label, index) =>
				'<button class="label-chip" data-index="' +
				index +
				'">' +
				escape_html(label) +
				' ×</button>',
		)
		.join('');
	document.querySelectorAll('.label-chip').forEach((el) => {
		el.onclick = () => {
			const next = read_labels();
			next.splice(Number(el.dataset.index), 1);
			write_labels(next);
			render_labels();
		};
	});
}
function save_label() {
	const value = label_input.value.trim();
	if (!value || !selected_id) return;
	const labels = read_labels();
	labels.push(value);
	write_labels(labels);
	label_input.value = '';
	render_labels();
}
function final_result_events(events) {
	return events.filter(
		(event) =>
			event.type === 'agent_end' ||
			event.type === 'message_end' ||
			event.type === 'session_shutdown',
	);
}

function number_value(value) {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: 0;
}
function walk_values(value, visit, seen = new Set()) {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	visit(value);
	if (Array.isArray(value)) {
		for (const item of value) walk_values(item, visit, seen);
		return;
	}
	for (const item of Object.values(value))
		walk_values(item, visit, seen);
}
function extract_usage(events) {
	const usage = { input: 0, output: 0, total: 0, cost: 0 };
	for (const event of events) {
		walk_values(event.payload, (object) => {
			const record = object;
			usage.input +=
				number_value(record.input_tokens) +
				number_value(record.prompt_tokens) +
				number_value(record.input);
			usage.output +=
				number_value(record.output_tokens) +
				number_value(record.completion_tokens) +
				number_value(record.output);
			usage.total += number_value(record.total_tokens);
			usage.cost +=
				number_value(record.total_cost) +
				number_value(record.cost_usd) +
				number_value(record.total);
		});
	}
	if (!usage.total) usage.total = usage.input + usage.output;
	return usage;
}
function extract_tool_runs(events) {
	const runs = new Map();
	for (const event of events) {
		const payload = event.payload || {};
		const id =
			payload.toolCallId || payload.tool_call_id || payload.id;
		if (!id || !String(event.type).includes('tool')) continue;
		const key = String(id);
		const run = runs.get(key) || {
			id: key,
			events: [],
			name: payload.toolName || payload.tool_name,
		};
		run.events.push(event);
		run.name =
			run.name || payload.toolName || payload.tool_name || event.type;
		if (event.type.endsWith('start')) run.start = event;
		if (event.type.endsWith('end') || event.type === 'tool_result')
			run.end = event;
		if (
			payload.isError ||
			payload.status === 'error' ||
			event_text(event).includes('error')
		)
			run.error = true;
		runs.set(key, run);
	}
	return [...runs.values()].map((run) => ({
		...run,
		duration:
			run.start && run.end ? elapsed_ms([run.start, run.end]) : 0,
	}));
}
function extract_provider_stats(events) {
	const provider = events.filter((event) =>
		String(event.type).includes('provider'),
	);
	const statuses = new Map();
	for (const event of provider) {
		const status =
			event.payload?.status || event.payload?.statusCode || 'unknown';
		statuses.set(status, (statuses.get(status) || 0) + 1);
	}
	return { count: provider.length, statuses };
}
function extract_artifacts(events) {
	const artifacts = [];
	for (const event of events) {
		const text = JSON.stringify(event.payload || {});
		const paths = [
			...text.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g),
		].map((match) => match[0]);
		const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
			(match) => match[0],
		);
		for (const value of [...paths, ...urls].slice(0, 6))
			artifacts.push({ event, value });
	}
	return artifacts;
}
function format_cost(value) {
	return value ? '$' + value.toFixed(value < 0.01 ? 4 : 2) : '—';
}

function project_key(session) {
	const cwd = String(session.cwd || 'unknown project');
	return cwd;
}
function project_name(session) {
	const cwd = String(session.cwd || 'unknown project').replace(
		/\/+$/,
		'',
	);
	return cwd.split('/').filter(Boolean).pop() || cwd;
}
function grouped_sessions() {
	const groups = new Map();
	for (const session of filtered_sessions()) {
		const key = project_key(session);
		if (!groups.has(key))
			groups.set(key, {
				key,
				name: project_name(session),
				sessions: [],
			});
		groups.get(key).sessions.push(session);
	}
	return [...groups.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
function filtered_sessions() {
	const query = search_input.value.trim().toLowerCase();
	if (!query) return session_cache;
	return session_cache.filter((session) =>
		[
			session.session_id,
			session.agent_name,
			session.pool,
			session.model,
			session.provider,
			...(session.tags || []),
		]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(query)),
	);
}
function payload_path(payload, path) {
	return path
		.split('.')
		.reduce((value, key) => value?.[key], payload);
}
function query_matches(event, query) {
	if (!query) return true;
	const text = event_text(event);
	for (const part of query.split(/\s+/).filter(Boolean)) {
		const [key, ...rest] = part.split(':');
		const value = rest.join(':').toLowerCase();
		if (!value) {
			if (!text.includes(key.toLowerCase())) return false;
			continue;
		}
		if (
			key === 'type' &&
			!String(event.type).toLowerCase().includes(value)
		)
			return false;
		else if (
			key === 'tool' &&
			!text.includes(`tool${value}`) &&
			!text.includes(value)
		)
			return false;
		else if (key === 'status' && !text.includes(value)) return false;
		else if (key === 'json') {
			const [path, expected = ''] = value.split('=');
			const actual = payload_path(event.payload, path);
			if (
				!String(actual ?? '')
					.toLowerCase()
					.includes(expected)
			)
				return false;
		} else if (!text.includes(part.toLowerCase())) return false;
	}
	return true;
}
function filtered_events(events) {
	const type = type_filter.value;
	const query = event_search_input.value.trim().toLowerCase();
	return events.filter((event) => {
		if (type && event.type !== type) return false;
		return query_matches(event, query);
	});
}
function update_type_filter() {
	const selected = type_filter.value;
	type_filter.innerHTML =
		'<option value="">All event types</option>' +
		[...known_types]
			.sort((a, b) => String(a).localeCompare(String(b)))
			.map(
				(type) =>
					'<option value="' +
					escape_html(type) +
					'">' +
					escape_html(type) +
					'</option>',
			)
			.join('');
	type_filter.value = selected;
}
function is_session_active(session) {
	const last = new Date(session.last_ts).valueOf();
	return !Number.isNaN(last) && Date.now() - last < 2 * 60 * 1000;
}
function update_stats() {
	session_count.textContent = session_cache.length;
	event_count.textContent = session_cache.reduce(
		(total, session) => total + Number(session.event_count || 0),
		0,
	);
	visible_count.textContent = filtered_sessions().length;
}
async function load_sessions() {
	const response = await fetch(api('/sessions'));
	const body = await response.json();
	session_cache = body.sessions || [];
	render_sessions();
	if (selected_id && !event_cache.has(selected_id))
		await fetch_events(selected_id);
	if (current_view !== 'single') await load_all_events();
	render_active();
}
function render_sessions() {
	const visible = filtered_sessions();
	if (!selected_id && visible[0]) selected_id = visible[0].session_id;
	sessions.innerHTML =
		grouped_sessions()
			.map((group) => {
				const event_total = group.sessions.reduce(
					(total, session) =>
						total + Number(session.event_count || 0),
					0,
				);
				const active_total =
					group.sessions.filter(is_session_active).length;
				return (
					'<details class="project-group" open><summary><div><strong>' +
					escape_html(group.name) +
					'</strong><div class="session-meta">' +
					escape_html(group.key) +
					'</div></div><span class="pill ' +
					(active_total ? 'active-pill' : '') +
					'">' +
					(active_total ? active_total + ' active · ' : '') +
					group.sessions.length +
					' sessions · ' +
					event_total +
					' events</span></summary>' +
					group.sessions
						.map(
							(session) =>
								'<div class="session ' +
								(session.session_id === selected_id
									? 'active '
									: '') +
								(is_session_active(session) ? 'running' : '') +
								'" data-id="' +
								escape_html(session.session_id) +
								'"><div class="session-top"><div class="session-name">' +
								(is_session_active(session)
									? '<span class="active-dot" title="active in the last 2 minutes"></span>'
									: '') +
								label_session(session) +
								'</div><span class="pill">' +
								Number(session.event_count || 0) +
								'</span></div><div class="session-meta">' +
								escape_html(session.pool || 'default') +
								' · ' +
								escape_html(
									session.model ||
										session.provider ||
										'model unknown',
								) +
								'</div><div class="tag-row">' +
								(session.tags || [])
									.slice(0, 3)
									.map(
										(tag) => '<span>' + escape_html(tag) + '</span>',
									)
									.join('') +
								'</div><div class="session-meta">' +
								escape_html(session.last_ts || '') +
								'</div></div>',
						)
						.join('') +
					'</details>'
				);
			})
			.join('') ||
		'<div class="empty">No matching sessions yet.</div>';
	document
		.querySelectorAll('.session')
		.forEach(
			(el) => (el.onclick = () => select_session(el.dataset.id)),
		);
	update_stats();
}

async function fetch_events(id) {
	if (event_cache.has(id)) return event_cache.get(id);
	const response = await fetch(
		api('/sessions/' + encodeURIComponent(id) + '/events?limit=1000'),
	);
	const body = await response.json();
	const events = body.events || [];
	events.forEach((event) => known_types.add(event.type));
	event_cache.set(id, events);
	update_type_filter();
	return events;
}
async function load_all_events() {
	await Promise.all(
		filtered_sessions()
			.slice(0, 8)
			.map((session) => fetch_events(session.session_id)),
	);
}
async function select_session(id) {
	selected_id = id;
	await fetch_events(id);
	current_view = 'single';
	void set_view('single');
	render_sessions();
}
function render_overview(events) {
	const selected = session_cache.find(
		(session) => session.session_id === selected_id,
	);
	const filtered = filtered_events(events);
	const types = new Map();
	for (const event of filtered)
		types.set(event.type, (types.get(event.type) || 0) + 1);
	const tools = extract_tool_runs(filtered);
	const tool_events = filtered.filter((event) =>
		event.type.includes('tool'),
	);
	const provider = extract_provider_stats(filtered);
	const usage = extract_usage(filtered);
	const artifacts = extract_artifacts(filtered);
	const final_events = final_result_events(filtered);
	const errors = filtered.filter(
		(event) =>
			event.type === 'error' || event_text(event).includes('error'),
	);
	const type_rows = [...types.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(
			([type, count]) =>
				'<div class="breakdown-row"><span class="type">' +
				escape_html(type) +
				'</span><strong>' +
				count +
				'</strong></div>',
		)
		.join('');
	const tool_rows = tools
		.sort((a, b) => b.duration - a.duration)
		.slice(0, 8)
		.map(
			(run) =>
				'<div class="tool-row"><span class="pill status-pill">' +
				(run.error ? 'error' : format_duration(run.duration)) +
				'</span><div class="tool-row-body"><strong class="row-title">' +
				escape_html(run.name || run.id) +
				'</strong><div class="muted row-meta">' +
				escape_html(run.id) +
				' · ' +
				run.events.length +
				' events</div></div></div>',
		)
		.join('');
	const provider_rows = [...provider.statuses.entries()]
		.map(
			([status, count]) =>
				'<div class="breakdown-row"><span>HTTP/status ' +
				escape_html(status) +
				'</span><strong>' +
				count +
				'</strong></div>',
		)
		.join('');
	const artifact_rows = artifacts
		.slice(0, 8)
		.map(
			(item) =>
				'<div class="tool-row"><span class="pill id-pill">#' +
				item.event.seq +
				'</span><div class="tool-row-body"><strong class="row-title path-title" title="' +
				escape_html(item.value) +
				'">' +
				escape_html(item.value) +
				'</strong><div class="muted row-meta">' +
				escape_html(item.event.type) +
				'</div></div></div>',
		)
		.join('');
	overview.innerHTML =
		'<div class="summary-card hero-summary compact-hero"><div><div class="eyebrow">Selected trace</div><h2>' +
		(selected ? label_session(selected) : 'No session selected') +
		'</h2><p>' +
		escape_html(selected?.cwd || '') +
		'</p></div><div class="summary-metrics"><div><strong>' +
		filtered.length +
		'</strong><span>events</span></div><div><strong>' +
		format_duration(elapsed_ms(filtered)) +
		'</strong><span>elapsed</span></div><div><strong>' +
		tools.length +
		'</strong><span>tools</span></div><div><strong>' +
		errors.length +
		'</strong><span>errors</span></div></div></div>' +
		'<details class="summary-drawer"><summary><span>Trace insights</span><span class="muted">tokens, tools, providers, artifacts, outputs, mix</span></summary>' +
		'<div class="summary-grid"><div class="summary-card"><h3>Token + cost rollup</h3>' +
		'<div class="breakdown-row"><span>input tokens</span><strong>' +
		usage.input +
		'</strong></div><div class="breakdown-row"><span>output tokens</span><strong>' +
		usage.output +
		'</strong></div><div class="breakdown-row"><span>total tokens</span><strong>' +
		usage.total +
		'</strong></div><div class="breakdown-row"><span>estimated cost</span><strong>' +
		format_cost(usage.cost) +
		'</strong></div></div><div class="summary-card"><h3>Tool runs by duration/status</h3>' +
		(tool_rows ||
			'<div class="empty compact">No tool runs in this trace.</div>') +
		'</div><div class="summary-card"><h3>Provider statuses</h3>' +
		(provider_rows ||
			'<div class="empty compact">No provider events.</div>') +
		'</div><div class="summary-card"><h3>Artifacts and links</h3>' +
		(artifact_rows ||
			'<div class="empty compact">No obvious paths or links found.</div>') +
		'</div><div class="summary-card"><h3>Final outputs</h3>' +
		(final_events.slice(-4).map(render_compact_event).join('') ||
			'<div class="empty compact">No final output events.</div>') +
		'</div><div class="summary-card"><h3>Event mix</h3>' +
		(type_rows || '<div class="empty compact">No events.</div>') +
		'</div><div class="summary-card"><h3>Recent tool activity</h3>' +
		(tool_events.slice(0, 8).map(render_compact_event).join('') ||
			'<div class="empty compact">No tool events.</div>') +
		'</div></div></details>';
}
function render_compact_event(event) {
	return (
		'<div class="tool-row"><span class="pill id-pill">#' +
		event.seq +
		'</span><div class="tool-row-body"><strong class="row-title compact-preview">' +
		escape_html(summarize_payload(event) || event.type) +
		'</strong><div class="muted row-meta">' +
		short_time(event.ts) +
		' · ' +
		escape_html(event.type) +
		'</div></div></div>'
	);
}

function render_timeline(events) {
	const filtered = filtered_events(events);
	const times = filtered
		.map((event) => new Date(event.ts).valueOf())
		.filter((value) => !Number.isNaN(value));
	const min = times.length ? Math.min(...times) : 0;
	const max = times.length ? Math.max(...times) : min + 1;
	timeline.innerHTML = filtered
		.slice()
		.reverse()
		.map((event) => {
			const time = new Date(event.ts).valueOf();
			const left = Number.isNaN(time)
				? 0
				: ((time - min) / Math.max(1, max - min)) * 100;
			return (
				'<button class="tick" style="left:' +
				left.toFixed(2) +
				'%" title="#' +
				event.seq +
				' ' +
				escape_html(event.type) +
				'"></button>'
			);
		})
		.join('');
}
function render_event(event) {
	return (
		'<details class="event"><summary><div class="event-head"><span class="pill">#' +
		event.seq +
		'</span><strong class="type">' +
		escape_html(event.type) +
		'</strong><span class="muted">' +
		short_time(event.ts) +
		'</span></div><div class="event-summary">' +
		escape_html(summarize_payload(event)) +
		'</div></summary><div class="event-meta">' +
		escape_html(event.model || event.provider || '') +
		'</div><pre>' +
		escape_html(JSON.stringify(event.payload, null, 2)) +
		'</pre></details>'
	);
}
function render_single() {
	const events = event_cache.get(selected_id) || [];
	const filtered = filtered_events(events);
	render_overview(events);
	render_timeline(events);
	render_labels();
	single_view.innerHTML =
		filtered.map(render_event).join('') ||
		'<div class="empty">No events loaded. Select a session or wait for live events.</div>';
}
function span_duration(start, end) {
	const a = new Date(start).valueOf();
	const b = new Date(end || start).valueOf();
	if (Number.isNaN(a) || Number.isNaN(b)) return '—';
	return format_duration(Math.max(0, b - a));
}
function render_trace() {
	const events = filtered_events(event_cache.get(selected_id) || [])
		.slice()
		.reverse();
	const turns = [];
	let current = null;
	for (const event of events) {
		if (event.type === 'turn_start') {
			current = { start: event, events: [], tools: [] };
			turns.push(current);
			continue;
		}
		if (!current) {
			current = { start: null, events: [], tools: [] };
			turns.push(current);
		}
		if (event.type === 'turn_end') current.end = event;
		else current.events.push(event);
	}
	trace_view.innerHTML =
		turns
			.map((turn, index) => {
				const tool_events = turn.events.filter((event) =>
					String(event.type).includes('tool'),
				);
				const provider_events = turn.events.filter((event) =>
					String(event.type).includes('provider'),
				);
				const message_events = turn.events.filter((event) =>
					String(event.type).includes('message'),
				);
				return (
					'<section class="trace-turn"><header><div><div class="eyebrow">Turn ' +
					(index + 1) +
					'</div><h3>' +
					escape_html(turn.start?.payload?.turnIndex ?? index) +
					'</h3></div><div class="trace-metrics"><span class="pill">' +
					span_duration(
						turn.start?.ts || turn.events[0]?.ts,
						turn.end?.ts || turn.events.at(-1)?.ts,
					) +
					'</span><span class="pill">' +
					tool_events.length +
					' tool</span><span class="pill">' +
					provider_events.length +
					' provider</span><span class="pill">' +
					message_events.length +
					' message</span></div></header>' +
					turn.events
						.map(
							(event) =>
								'<div class="trace-row"><span class="pill">#' +
								event.seq +
								'</span><strong class="type">' +
								escape_html(event.type) +
								'</strong><span class="muted">' +
								short_time(event.ts) +
								'</span><span>' +
								escape_html(summarize_payload(event)) +
								'</span></div>',
						)
						.join('') +
					'</section>'
				);
			})
			.join('') || '<div class="empty">No trace events loaded.</div>';
}
function render_swimlane() {
	swimlane_view.innerHTML =
		filtered_sessions()
			.slice(0, 8)
			.map((session) => {
				const events = filtered_events(
					event_cache.get(session.session_id) || [],
				);
				return (
					'<div class="lane"><h3>' +
					label_session(session) +
					'<div class="muted">' +
					escape_html(session.pool || 'default') +
					' · ' +
					events.length +
					' shown · ' +
					format_duration(elapsed_ms(events)) +
					'</div></h3>' +
					events
						.map(
							(event) =>
								'<div class="lane-event"><span class="pill">#' +
								event.seq +
								'</span> <strong class="type">' +
								escape_html(event.type) +
								'</strong><div class="muted">' +
								short_time(event.ts) +
								'</div><div class="lane-summary">' +
								escape_html(summarize_payload(event)) +
								'</div></div>',
						)
						.join('') +
					'</div>'
				);
			})
			.join('') || '<div class="empty">No sessions to compare.</div>';
}
function render_race() {
	const rows = [];
	for (const session of filtered_sessions().slice(0, 8)) {
		for (const event of filtered_events(
			event_cache.get(session.session_id) || [],
		))
			rows.push({ session, event });
	}
	rows.sort((a, b) => a.event.ts.localeCompare(b.event.ts));
	race_view.innerHTML =
		'<table><thead><tr><th>Time</th><th>Session</th><th>Seq</th><th>Event</th><th>Summary</th></tr></thead><tbody>' +
		rows
			.map(
				(row) =>
					'<tr><td>' +
					short_time(row.event.ts) +
					'</td><td>' +
					label_session(row.session) +
					'</td><td>#' +
					row.event.seq +
					'</td><td class="type">' +
					escape_html(row.event.type) +
					'</td><td>' +
					escape_html(summarize_payload(row.event)) +
					'</td></tr>',
			)
			.join('') +
		'</tbody></table>';
}
function render_active() {
	render_sessions();
	if (current_view === 'single') render_single();
	else if (current_view === 'trace') render_trace();
	else if (current_view === 'swimlane') render_swimlane();
	else if (current_view === 'race') render_race();
}
async function set_view(view) {
	current_view = view;
	single_btn.classList.toggle('active', view === 'single');
	trace_btn.classList.toggle('active', view === 'trace');
	swimlane_btn.classList.toggle('active', view === 'swimlane');
	race_btn.classList.toggle('active', view === 'race');
	single_view.classList.toggle('hidden', view !== 'single');
	trace_view.classList.toggle('hidden', view !== 'trace');
	swimlane_view.classList.toggle('hidden', view !== 'swimlane');
	race_view.classList.toggle('hidden', view !== 'race');
	if (view !== 'single' && view !== 'trace') await load_all_events();
	render_active();
}
single_btn.onclick = () => void set_view('single');
trace_btn.onclick = () => void set_view('trace');
swimlane_btn.onclick = () => void set_view('swimlane');
race_btn.onclick = () => void set_view('race');
theme_btn.onclick = () => {
	const next =
		document.documentElement.dataset.theme === 'light'
			? 'dark'
			: 'light';
	localStorage.setItem(theme_key, next);
	apply_theme(next);
};
pause_btn.onclick = () => {
	paused = !paused;
	pause_btn.textContent = paused ? 'Resume' : 'Pause';
	live.classList.toggle('paused', paused);
	live.lastChild.textContent = paused ? ' paused' : ' live';
};
search_input.oninput = render_active;
event_search_input.oninput = render_active;
type_filter.onchange = render_active;
save_label_btn.onclick = save_label;
label_input.onkeydown = (event) => {
	if (event.key === 'Enter') save_label();
};
function schedule_live_render() {
	if (live_render_timer) return;
	live_render_timer = setTimeout(() => {
		live_render_timer = null;
		render_active();
	}, 150);
}
function schedule_session_reload() {
	if (session_reload_timer) return;
	session_reload_timer = setTimeout(() => {
		session_reload_timer = null;
		void load_sessions();
	}, 1000);
}
function connect() {
	const es = new EventSource(api('/events/stream'));
	es.addEventListener('hello', () => {
		live.classList.remove('disconnected');
		live.lastChild.textContent = paused ? ' paused' : ' live';
	});
	es.addEventListener('event', (msg) => {
		const event = JSON.parse(msg.data);
		known_types.add(event.type);
		const existing = event_cache.get(event.session_id) || [];
		if (!existing.some((item) => item.event_id === event.event_id))
			event_cache.set(event.session_id, [event, ...existing]);
		if (!selected_id) selected_id = event.session_id;
		update_type_filter();
		if (paused) return;
		schedule_session_reload();
		schedule_live_render();
	});
	es.onerror = () => {
		live.classList.add('disconnected');
		live.lastChild.textContent = ' reconnecting';
		es.close();
		setTimeout(connect, 1000);
	};
}
void load_sessions();
connect();
