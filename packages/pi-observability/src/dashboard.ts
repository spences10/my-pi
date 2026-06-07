// @ts-nocheck
const token_value =
	new URLSearchParams(location.search).get('token') || '';
let selected_id = null;
let current_view = 'single';
let session_cache = [];
let paused = false;
const event_cache = new Map();
const known_types = new Set();

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
function summarize_payload(event) {
	const payload = event.payload || {};
	if (payload.tool_name) return `tool: ${payload.tool_name}`;
	if (payload.name) return String(payload.name);
	if (payload.message) return String(payload.message).slice(0, 160);
	if (payload.error) return String(payload.error).slice(0, 160);
	if (payload.summary) return String(payload.summary).slice(0, 160);
	return JSON.stringify(payload).slice(0, 180);
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
function filtered_events(events) {
	const type = type_filter.value;
	const query = event_search_input.value.trim().toLowerCase();
	return events.filter((event) => {
		if (type && event.type !== type) return false;
		if (!query) return true;
		return (
			String(event.type).toLowerCase().includes(query) ||
			event_text(event).includes(query)
		);
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
				return (
					'<details class="project-group" open><summary><div><strong>' +
					escape_html(group.name) +
					'</strong><div class="session-meta">' +
					escape_html(group.key) +
					'</div></div><span class="pill">' +
					group.sessions.length +
					' sessions · ' +
					event_total +
					' events</span></summary>' +
					group.sessions
						.map(
							(session) =>
								'<div class="session ' +
								(session.session_id === selected_id ? 'active' : '') +
								'" data-id="' +
								escape_html(session.session_id) +
								'"><div class="session-top"><div class="session-name">' +
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
	const tools = filtered.filter((event) =>
		event.type.includes('tool'),
	);
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
		.slice(0, 8)
		.map(
			(event) =>
				'<div class="tool-row"><span class="pill">#' +
				event.seq +
				'</span><div><strong>' +
				escape_html(summarize_payload(event) || event.type) +
				'</strong><div class="muted">' +
				short_time(event.ts) +
				' · ' +
				escape_html(event.type) +
				'</div></div></div>',
		)
		.join('');
	overview.innerHTML =
		'<div class="summary-card hero-summary"><div><div class="eyebrow">Selected trace</div><h2>' +
		(selected ? label_session(selected) : 'No session selected') +
		'</h2><p>' +
		escape_html(selected?.cwd || '') +
		'</p></div><div class="summary-metrics"><div><strong>' +
		filtered.length +
		'</strong><span>shown events</span></div><div><strong>' +
		format_duration(elapsed_ms(filtered)) +
		'</strong><span>elapsed</span></div><div><strong>' +
		tools.length +
		'</strong><span>tool events</span></div><div><strong>' +
		errors.length +
		'</strong><span>possible errors</span></div></div></div>' +
		'<div class="summary-grid"><div class="summary-card"><h3>Event mix</h3>' +
		(type_rows || '<div class="empty compact">No events.</div>') +
		'</div><div class="summary-card"><h3>Recent tool activity</h3>' +
		(tool_rows ||
			'<div class="empty compact">No tool events in this trace.</div>') +
		'</div></div>';
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
		'<details class="event" open><summary><div class="event-head"><span class="pill">#' +
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
	render_single();
	render_trace();
	render_swimlane();
	render_race();
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
pause_btn.onclick = () => {
	paused = !paused;
	pause_btn.textContent = paused ? 'Resume' : 'Pause';
	live.classList.toggle('paused', paused);
	live.lastChild.textContent = paused ? ' paused' : ' live';
};
search_input.oninput = render_active;
event_search_input.oninput = render_active;
type_filter.onchange = render_active;
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
		void load_sessions();
		render_active();
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
