#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { ObservabilityEvent } from './types.js';

export interface ObservabilityServerOptions {
	host: string;
	port: number;
	token: string;
	db_path: string;
	log: boolean;
}

interface Subscriber {
	id: number;
	res: ServerResponse;
	pool?: string;
	tag?: string;
	session_id?: string;
}

interface PreparedStatements {
	insert_event: StatementSync;
	upsert_session: StatementSync;
	list_sessions: StatementSync;
	list_events: StatementSync;
}

export interface RunningObservabilityServer {
	server: Server;
	db: DatabaseSync;
	url: string;
	db_path: string;
	close: () => Promise<void>;
}

const schema = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS sessions (
	session_id TEXT PRIMARY KEY,
	pool TEXT NOT NULL DEFAULT 'default',
	agent_name TEXT,
	cwd TEXT,
	session_file TEXT,
	provider TEXT,
	model TEXT,
	first_ts TEXT NOT NULL,
	last_ts TEXT NOT NULL,
	event_count INTEGER NOT NULL DEFAULT 0,
	tags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
	event_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	ts TEXT NOT NULL,
	type TEXT NOT NULL,
	pool TEXT NOT NULL DEFAULT 'default',
	tags_json TEXT NOT NULL DEFAULT '[]',
	payload_json TEXT NOT NULL,
	provider TEXT,
	model TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_pool ON events(pool);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
`;

export function resolve_observability_server_options(
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityServerOptions {
	return {
		host: env.MY_PI_OBSERVABILITY_HOST ?? '127.0.0.1',
		port: Number(env.MY_PI_OBSERVABILITY_PORT ?? 43190),
		token: env.MY_PI_OBSERVABILITY_TOKEN ?? '',
		db_path: resolve(
			env.MY_PI_OBSERVABILITY_DB ??
				`${homedir()}/.pi/agent/observability.db`,
		),
		log: env.MY_PI_OBSERVABILITY_LOG !== '0',
	};
}

function prepare_db(db_path: string): {
	db: DatabaseSync;
	statements: PreparedStatements;
} {
	mkdirSync(dirname(db_path), { recursive: true });
	const db = new DatabaseSync(db_path);
	db.exec(schema);
	return {
		db,
		statements: {
			insert_event: db.prepare(`
INSERT OR IGNORE INTO events
(event_id, session_id, seq, ts, type, pool, tags_json, payload_json, provider, model)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`),
			upsert_session: db.prepare(`
INSERT INTO sessions
(session_id, pool, agent_name, cwd, session_file, provider, model, first_ts, last_ts, event_count, tags_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
ON CONFLICT(session_id) DO UPDATE SET
	pool = excluded.pool,
	agent_name = COALESCE(excluded.agent_name, sessions.agent_name),
	cwd = COALESCE(excluded.cwd, sessions.cwd),
	session_file = COALESCE(excluded.session_file, sessions.session_file),
	provider = COALESCE(excluded.provider, sessions.provider),
	model = COALESCE(excluded.model, sessions.model),
	last_ts = MAX(excluded.last_ts, sessions.last_ts),
	event_count = sessions.event_count + 1,
	tags_json = excluded.tags_json
`),
			list_sessions: db.prepare(`
SELECT * FROM sessions
WHERE (? = '' OR pool = ?)
ORDER BY last_ts DESC
LIMIT ?
`),
			list_events: db.prepare(
				'SELECT * FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
			),
		},
	};
}

function json(
	res: ServerResponse,
	status: number,
	body: unknown,
): void {
	res.writeHead(status, {
		'content-type': 'application/json',
		'access-control-allow-origin': '*',
	});
	res.end(JSON.stringify(body));
}

function is_authorized(
	req_url: URL,
	token: string,
	authorization?: string,
): boolean {
	if (!token) return true;
	if (req_url.searchParams.get('token') === token) return true;
	return authorization === `Bearer ${token}`;
}

function row_text(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function to_row_event(
	row: Record<string, unknown>,
): ObservabilityEvent {
	return {
		event_id: row_text(row.event_id, ''),
		session_id: row_text(row.session_id, ''),
		seq: Number(row.seq),
		ts: row_text(row.ts, ''),
		type: row.type as ObservabilityEvent['type'],
		cwd: '',
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		payload: JSON.parse(row_text(row.payload_json, '{}')),
	};
}

function to_session_row(row: Record<string, unknown>): unknown {
	return {
		...row,
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
	};
}

async function read_body(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString('utf8');
}

function render_dashboard(db_path: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pi Observability</title><style>
:root{color-scheme:dark}body{font:14px/1.4 system-ui;margin:0;background:#0b1020;color:#e5e7eb}header{padding:12px 16px;background:#111827;display:flex;gap:12px;align-items:center;position:sticky;top:0;z-index:2}button{background:#172033;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px 10px;cursor:pointer}button.active{background:#2563eb;border-color:#60a5fa}.layout{display:grid;grid-template-columns:320px 1fr;height:calc(100vh - 54px)}aside{border-right:1px solid #263244;overflow:auto}.session,.event,.lane-event{padding:10px 12px;border-bottom:1px solid #1f2937;cursor:pointer}.session:hover,.event:hover,.lane-event:hover{background:#172033}.muted{color:#94a3b8}.events{overflow:auto}.pill{font-size:12px;border:1px solid #334155;border-radius:999px;padding:2px 6px}.type{color:#93c5fd}pre{white-space:pre-wrap;word-break:break-word;background:#050816;padding:12px;border-radius:8px}.swimlane{display:flex;gap:10px;padding:10px;overflow:auto;height:calc(100% - 20px)}.lane{min-width:300px;max-width:380px;border:1px solid #263244;border-radius:12px;overflow:auto;background:#0f172a}.lane h3{margin:0;padding:10px;border-bottom:1px solid #263244;font-size:13px}.race{padding:12px}.race table{border-collapse:collapse;width:100%}.race td,.race th{border-bottom:1px solid #263244;padding:8px;text-align:left}.hidden{display:none}</style></head>
<body><header><strong>Pi Observability</strong><span id="live" class="pill">connecting</span><button id="single_btn" class="active">Single</button><button id="swimlane_btn">Swimlane</button><button id="race_btn">Race</button><span class="muted">DB: ${db_path}</span></header><div class="layout"><aside id="sessions"></aside><section class="events"><div id="single_view"></div><div id="swimlane_view" class="hidden swimlane"></div><div id="race_view" class="hidden race"></div></section></div>
<script>
const token_value = new URLSearchParams(location.search).get('token') || '';
let selected_id = null;
let current_view = 'single';
let session_cache = [];
const event_cache = new Map();
function api(path){ return path + (token_value ? (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token_value) : ''); }
function escape_html(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function label_session(s){return escape_html((s.agent_name||s.session_id).slice(0,40));}
async function load_sessions(){ const r=await fetch(api('/sessions')); const j=await r.json(); session_cache=j.sessions; sessions.innerHTML=session_cache.map(s=>'<div class="session" data-id="'+s.session_id+'"><strong>'+label_session(s)+'</strong><div class="muted">'+escape_html(s.pool)+' · '+s.event_count+' events</div><div class="muted">'+escape_html(s.last_ts)+'</div></div>').join(''); document.querySelectorAll('.session').forEach(el=>el.onclick=()=>select_session(el.dataset.id)); if(current_view!=='single') await load_all_events(); render_active(); }
async function fetch_events(id){ if(event_cache.has(id)) return event_cache.get(id); const r=await fetch(api('/sessions/'+encodeURIComponent(id)+'/events?limit=500')); const j=await r.json(); event_cache.set(id,j.events); return j.events; }
async function load_all_events(){ await Promise.all(session_cache.slice(0,8).map(s=>fetch_events(s.session_id))); }
async function select_session(id){ selected_id=id; await fetch_events(id); current_view='single'; set_view('single'); }
function render_event(e){ return '<div class="event"><span class="pill">'+e.seq+'</span> <strong class="type">'+escape_html(e.type)+'</strong> <span class="muted">'+escape_html(e.ts)+'</span><pre>'+escape_html(JSON.stringify(e.payload,null,2))+'</pre></div>'; }
function render_single(){ if(!selected_id&&session_cache[0]) selected_id=session_cache[0].session_id; const events=event_cache.get(selected_id)||[]; single_view.innerHTML=events.map(render_event).join('') || '<p class="muted" style="padding:12px">No session selected.</p>'; }
function render_swimlane(){ swimlane_view.innerHTML=session_cache.slice(0,8).map(s=>{ const events=event_cache.get(s.session_id)||[]; return '<div class="lane"><h3>'+label_session(s)+'<div class="muted">'+escape_html(s.pool)+' · '+events.length+' shown</div></h3>'+events.map(e=>'<div class="lane-event"><span class="pill">'+e.seq+'</span> <strong class="type">'+escape_html(e.type)+'</strong><div class="muted">'+escape_html(e.ts)+'</div></div>').join('')+'</div>'; }).join(''); }
function render_race(){ const rows=[]; for(const s of session_cache.slice(0,8)){ for(const e of (event_cache.get(s.session_id)||[])){ rows.push({session:s,event:e}); } } rows.sort((a,b)=>a.event.ts.localeCompare(b.event.ts)); race_view.innerHTML='<table><thead><tr><th>Time</th><th>Session</th><th>Seq</th><th>Event</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escape_html(r.event.ts)+'</td><td>'+label_session(r.session)+'</td><td>'+r.event.seq+'</td><td class="type">'+escape_html(r.event.type)+'</td></tr>').join('')+'</tbody></table>'; }
function render_active(){ render_single(); render_swimlane(); render_race(); }
async function set_view(view){ current_view=view; single_btn.classList.toggle('active',view==='single'); swimlane_btn.classList.toggle('active',view==='swimlane'); race_btn.classList.toggle('active',view==='race'); single_view.classList.toggle('hidden',view!=='single'); swimlane_view.classList.toggle('hidden',view!=='swimlane'); race_view.classList.toggle('hidden',view!=='race'); if(view!=='single') await load_all_events(); render_active(); }
single_btn.onclick=()=>set_view('single'); swimlane_btn.onclick=()=>set_view('swimlane'); race_btn.onclick=()=>set_view('race');
function connect(){ const es=new EventSource(api('/events/stream')); es.addEventListener('hello',()=>live.textContent='live'); es.addEventListener('event',msg=>{ const e=JSON.parse(msg.data); const existing=event_cache.get(e.session_id)||[]; if(!existing.some(item=>item.event_id===e.event_id)){ event_cache.set(e.session_id,[e,...existing]); } load_sessions(); if(!selected_id) selected_id=e.session_id; render_active(); }); es.onerror=()=>{live.textContent='reconnecting'; es.close(); setTimeout(connect,1000);}; }
load_sessions(); connect();
</script></body></html>`;
}

export function start_observability_server(
	options: ObservabilityServerOptions = resolve_observability_server_options(),
): RunningObservabilityServer {
	const { db, statements } = prepare_db(options.db_path);
	let next_subscriber_id = 1;
	const subscribers = new Map<number, Subscriber>();

	function broadcast(event: ObservabilityEvent): void {
		const frame = `event: event\ndata: ${JSON.stringify(event)}\n\n`;
		for (const sub of subscribers.values()) {
			if (sub.pool && sub.pool !== event.pool) continue;
			if (sub.tag && !event.tags.includes(sub.tag)) continue;
			if (sub.session_id && sub.session_id !== event.session_id)
				continue;
			sub.res.write(frame);
		}
	}

	function ingest(event: ObservabilityEvent): boolean {
		const tags_json = JSON.stringify(event.tags ?? []);
		const result = statements.insert_event.run(
			event.event_id,
			event.session_id,
			event.seq,
			event.ts,
			event.type,
			event.pool ?? 'default',
			tags_json,
			JSON.stringify(event.payload ?? {}),
			event.provider ?? null,
			event.model ?? null,
		);
		if (result.changes === 0) return false;
		statements.upsert_session.run(
			event.session_id,
			event.pool ?? 'default',
			event.agent_name ?? null,
			event.cwd ?? '',
			event.session_file ?? null,
			event.provider ?? null,
			event.model ?? null,
			event.ts,
			event.ts,
			tags_json,
		);
		broadcast(event);
		return true;
	}

	const server = createServer(async (req, res) => {
		try {
			if (!req.url) return json(res, 400, { error: 'missing url' });
			const req_url = new URL(
				req.url,
				`http://${options.host}:${options.port}`,
			);
			if (req.method === 'OPTIONS') return json(res, 200, {});
			if (req_url.pathname === '/health') {
				return json(res, 200, { ok: true });
			}
			if (req_url.pathname === '/') {
				res.writeHead(200, { 'content-type': 'text/html' });
				res.end(render_dashboard(options.db_path));
				return;
			}
			if (
				!is_authorized(
					req_url,
					options.token,
					req.headers.authorization,
				)
			) {
				return json(res, 401, { error: 'unauthorized' });
			}
			if (req_url.pathname === '/events' && req.method === 'POST') {
				const parsed = JSON.parse(await read_body(req));
				const events = Array.isArray(parsed) ? parsed : [parsed];
				let ingested = 0;
				for (const event of events) if (ingest(event)) ingested++;
				return json(res, 200, {
					ingested,
					rejected: events.length - ingested,
				});
			}
			if (req_url.pathname === '/sessions') {
				const limit = Math.min(
					Number(req_url.searchParams.get('limit') ?? 100),
					500,
				);
				const pool = req_url.searchParams.get('pool') ?? '';
				const rows = statements.list_sessions.all(
					pool,
					pool,
					limit,
				) as Record<string, unknown>[];
				const tag = req_url.searchParams.get('tag');
				const sessions = rows.map(to_session_row).filter((row) => {
					if (!tag) return true;
					return (row as { tags?: string[] }).tags?.includes(tag);
				});
				return json(res, 200, { sessions });
			}
			const events_match = req_url.pathname.match(
				/^\/sessions\/([^/]+)\/events$/,
			);
			if (events_match) {
				const limit = Math.min(
					Number(req_url.searchParams.get('limit') ?? 300),
					1000,
				);
				const rows = statements.list_events.all(
					decodeURIComponent(events_match[1]),
					limit,
				) as Record<string, unknown>[];
				return json(res, 200, { events: rows.map(to_row_event) });
			}
			if (req_url.pathname === '/events/stream') {
				res.writeHead(200, {
					'content-type': 'text/event-stream',
					'cache-control': 'no-cache',
					connection: 'keep-alive',
					'access-control-allow-origin': '*',
				});
				const id = next_subscriber_id++;
				subscribers.set(id, {
					id,
					res,
					pool: req_url.searchParams.get('pool') ?? undefined,
					tag: req_url.searchParams.get('tag') ?? undefined,
					session_id:
						req_url.searchParams.get('session_id') ?? undefined,
				});
				res.write('retry: 2000\nevent: hello\ndata: {}\n\n');
				req.on('close', () => subscribers.delete(id));
				return;
			}
			return json(res, 404, { error: 'not found' });
		} catch (error) {
			return json(res, 500, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	const heartbeat = setInterval(() => {
		for (const sub of subscribers.values())
			sub.res.write(': ping\n\n');
	}, 15_000);

	server.listen(options.port, options.host, () => {
		if (!options.log) return;
		console.log(
			`Pi observability listening on http://${options.host}:${options.port}`,
		);
		console.log(`Database: ${options.db_path}`);
	});

	return {
		server,
		db,
		url: `http://${options.host}:${options.port}`,
		db_path: options.db_path,
		close: async () => {
			clearInterval(heartbeat);
			await new Promise<void>((resolve_close) => {
				server.close(() => resolve_close());
			});
			db.close();
		},
	};
}

const is_direct_run =
	process.argv[1] === fileURLToPath(import.meta.url);

if (is_direct_run) {
	start_observability_server();
}
