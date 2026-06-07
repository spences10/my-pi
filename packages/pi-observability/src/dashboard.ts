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
	return type
		? events.filter((event) => event.type === type)
		: events;
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
		visible
			.map(
				(session) =>
					'<div class="session ' +
					(session.session_id === selected_id ? 'active' : '') +
					'" data-id="' +
					escape_html(session.session_id) +
					'">' +
					'<div class="session-top"><div class="session-name">' +
					label_session(session) +
					'</div><span class="pill">' +
					Number(session.event_count || 0) +
					'</span></div>' +
					'<div class="session-meta">' +
					escape_html(session.pool || 'default') +
					' · ' +
					escape_html(
						session.model || session.provider || 'model unknown',
					) +
					'</div>' +
					'<div class="session-meta">' +
					escape_html(session.last_ts || '') +
					'</div>' +
					'</div>',
			)
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
		api('/sessions/' + encodeURIComponent(id) + '/events?limit=500'),
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
function render_event(event) {
	return (
		'<div class="event"><div class="event-head"><span class="pill">#' +
		event.seq +
		'</span><strong class="type">' +
		escape_html(event.type) +
		'</strong><span class="muted">' +
		short_time(event.ts) +
		'</span></div><div class="event-meta">' +
		escape_html(event.model || event.provider || '') +
		'</div><pre>' +
		escape_html(JSON.stringify(event.payload, null, 2)) +
		'</pre></div>'
	);
}
function render_single() {
	const events = filtered_events(event_cache.get(selected_id) || []);
	single_view.innerHTML =
		events.map(render_event).join('') ||
		'<div class="empty">No events loaded. Select a session or wait for live events.</div>';
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
					' shown</div></h3>' +
					events
						.map(
							(event) =>
								'<div class="lane-event"><span class="pill">#' +
								event.seq +
								'</span> <strong class="type">' +
								escape_html(event.type) +
								'</strong><div class="muted">' +
								short_time(event.ts) +
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
		'<table><thead><tr><th>Time</th><th>Session</th><th>Seq</th><th>Event</th></tr></thead><tbody>' +
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
					'</td></tr>',
			)
			.join('') +
		'</tbody></table>';
}
function render_active() {
	render_sessions();
	render_single();
	render_swimlane();
	render_race();
}
async function set_view(view) {
	current_view = view;
	single_btn.classList.toggle('active', view === 'single');
	swimlane_btn.classList.toggle('active', view === 'swimlane');
	race_btn.classList.toggle('active', view === 'race');
	single_view.classList.toggle('hidden', view !== 'single');
	swimlane_view.classList.toggle('hidden', view !== 'swimlane');
	race_view.classList.toggle('hidden', view !== 'race');
	if (view !== 'single') await load_all_events();
	render_active();
}
single_btn.onclick = () => void set_view('single');
swimlane_btn.onclick = () => void set_view('swimlane');
race_btn.onclick = () => void set_view('race');
pause_btn.onclick = () => {
	paused = !paused;
	pause_btn.textContent = paused ? 'Resume' : 'Pause';
	live.classList.toggle('paused', paused);
	live.lastChild.textContent = paused ? ' paused' : ' live';
};
search_input.oninput = render_active;
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
