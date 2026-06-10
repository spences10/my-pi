#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
import type {
	DashboardSession,
	ObservabilityEvent,
	TraceMetricsSummary,
	TraceSpanSummary,
	TraceSummary,
} from './types.js';

export interface ObservabilityServerOptions {
	host: string;
	port: number;
	token: string;
	db_path: string;
	log: boolean;
	retention_days?: number;
	max_events?: number;
}

interface Subscriber {
	id: number;
	res: ServerResponse;
	pool?: string;
	tag?: string;
	session_id?: string;
}

interface PreparedStatements {
	next_event_seq: StatementSync;
	insert_event: StatementSync;
	upsert_session: StatementSync;
	list_sessions: StatementSync;
	list_events: StatementSync;
	search_events: StatementSync;
	delete_old_events: StatementSync;
	delete_over_limit_events: StatementSync;
	delete_orphan_sessions: StatementSync;
}

export interface RunningObservabilityServer {
	server: Server;
	db: DatabaseSync;
	url: string;
	db_path: string;
	close: () => Promise<void>;
}

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf8',
);
const DASHBOARD_HTML_URL = new URL(
	'./web/index.html',
	import.meta.url,
);
const FONT_URLS = new Map([
	[
		'/fonts/victor-mono-latin-400-normal.woff2',
		new URL(
			'./fonts/victor-mono-latin-400-normal.woff2',
			import.meta.url,
		),
	],
	[
		'/fonts/victor-mono-latin-700-normal.woff2',
		new URL(
			'./fonts/victor-mono-latin-700-normal.woff2',
			import.meta.url,
		),
	],
]);
const SERVER_STARTED_AT = new Date().toISOString();

function read_dashboard_html(): string {
	return readFileSync(DASHBOARD_HTML_URL, 'utf8');
}

function read_dashboard_asset(pathname: string): Buffer | undefined {
	if (!pathname.startsWith('/assets/')) return undefined;
	try {
		return readFileSync(new URL(`./web${pathname}`, import.meta.url));
	} catch {
		return undefined;
	}
}

function content_type(pathname: string): string {
	if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
	if (pathname.endsWith('.js'))
		return 'text/javascript; charset=utf-8';
	if (pathname.endsWith('.svg')) return 'image/svg+xml';
	return 'application/octet-stream';
}
function read_dashboard_font(pathname: string): Buffer | undefined {
	const url = FONT_URLS.get(pathname);
	return url ? readFileSync(url) : undefined;
}
const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;
const CONNECTION_PRAGMAS = `
PRAGMA busy_timeout = 5000;
`;
function parse_positive_integer(
	value: string | undefined,
	fallback: number,
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed) || parsed < 1) return fallback;
	return parsed;
}

function parse_port(value: string | undefined): number {
	const port = parse_positive_integer(value, 43190);
	if (port > 65535) return 43190;
	return port;
}

export function resolve_observability_server_options(
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityServerOptions {
	return {
		host: env.MY_PI_OBSERVABILITY_HOST ?? '127.0.0.1',
		port: parse_port(env.MY_PI_OBSERVABILITY_PORT),
		token: env.MY_PI_OBSERVABILITY_TOKEN ?? '',
		db_path: resolve(
			env.MY_PI_OBSERVABILITY_DB ??
				`${homedir()}/.pi/agent/observability.db`,
		),
		log: env.MY_PI_OBSERVABILITY_LOG !== '0',
		retention_days: parse_positive_integer(
			env.MY_PI_OBSERVABILITY_RETENTION_DAYS,
			14,
		),
		max_events: parse_positive_integer(
			env.MY_PI_OBSERVABILITY_MAX_EVENTS,
			100_000,
		),
	};
}

function prepare_db(db_path: string): {
	db: DatabaseSync;
	statements: PreparedStatements;
} {
	mkdirSync(dirname(db_path), { recursive: true });
	const db = new DatabaseSync(db_path);
	db.exec(PERSISTENT_PRAGMAS);
	db.exec(CONNECTION_PRAGMAS);
	db.exec(SCHEMA);
	return {
		db,
		statements: {
			next_event_seq: db.prepare(`
				SELECT COALESCE(MAX(seq) + 1, 0) AS seq
				FROM events
				WHERE session_id = ?
			`),
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
			list_events: db.prepare(`
				SELECT * FROM events
				WHERE session_id = ?
				ORDER BY seq DESC
				LIMIT ?
			`),
			search_events: db.prepare(`
				SELECT * FROM events
				WHERE (? = '' OR session_id = ?)
					AND (? = '' OR type = ?)
					AND (? = '' OR payload_json LIKE ?)
				ORDER BY ts DESC
				LIMIT ?
			`),
			delete_old_events: db.prepare(`
				DELETE FROM events
				WHERE ts < datetime('now', '-' || ? || ' days')
			`),
			delete_over_limit_events: db.prepare(`
				DELETE FROM events
				WHERE event_id IN (
					SELECT event_id FROM events ORDER BY ts DESC LIMIT -1 OFFSET ?
				)
			`),
			delete_orphan_sessions: db.prepare(`
				DELETE FROM sessions
				WHERE session_id NOT IN (SELECT DISTINCT session_id FROM events)
			`),
		},
	};
}

function text(
	res: ServerResponse,
	status: number,
	content_type: string,
	body: string,
): void {
	res.writeHead(status, {
		'content-type': content_type,
		'access-control-allow-origin': '*',
		'cache-control': 'no-store, max-age=0',
	});
	res.end(body);
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

function binary(
	res: ServerResponse,
	status: number,
	content_type: string,
	body: Buffer,
): void {
	res.writeHead(status, {
		'content-type': content_type,
		'access-control-allow-origin': '*',
		'cache-control': 'public, max-age=31536000, immutable',
	});
	res.end(body);
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

function describe_port_owner(port: number): string {
	try {
		return execFileSync(
			'lsof',
			['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		).trim();
	} catch {
		try {
			return execFileSync('ss', ['-ltnp'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			})
				.split('\n')
				.filter((line) => line.includes(`:${port}`))
				.join('\n')
				.trim();
		} catch {
			return '';
		}
	}
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

function to_session_row(
	row: Record<string, unknown>,
): DashboardSession {
	return {
		session_id: row_text(row.session_id, ''),
		session_file: row_text(row.session_file, '') || undefined,
		cwd: row_text(row.cwd, ''),
		agent_name: row_text(row.agent_name, '') || undefined,
		pool: row_text(row.pool, 'default'),
		tags: JSON.parse(row_text(row.tags_json, '[]')) as string[],
		provider: row_text(row.provider, '') || undefined,
		model: row_text(row.model, '') || undefined,
		last_ts: row_text(row.last_ts, ''),
		event_count: Number(row.event_count),
	};
}

function timestamp_ms(value: string | undefined): number {
	const time = new Date(value ?? '').valueOf();
	return Number.isNaN(time) ? 0 : time;
}

function duration_ms(events: ObservabilityEvent[]): number {
	const times = events
		.map((event) => timestamp_ms(event.ts))
		.filter(Boolean);
	return times.length > 1
		? Math.max(...times) - Math.min(...times)
		: 0;
}

function number_value(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value))
		return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function record_value(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const value = record[key];
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function walk_payload(
	value: unknown,
	visit: (record: Record<string, unknown>) => void,
): void {
	if (!value || typeof value !== 'object') return;
	visit(value as Record<string, unknown>);
	for (const item of Object.values(value)) walk_payload(item, visit);
}

function payload_text(event: ObservabilityEvent): string {
	return JSON.stringify(event.payload ?? {}).toLowerCase();
}

function text_value(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	if (value == null) return fallback;
	return JSON.stringify(value);
}

function span_name(event: ObservabilityEvent): string {
	const payload = (event.payload ?? {}) as Record<string, unknown>;
	return text_value(
		payload.tool_name ?? payload.toolName ?? payload.name,
		event.type,
	);
}

function session_file_usage(
	session_file: string | undefined,
): Pick<
	TraceMetricsSummary,
	'input_tokens' | 'output_tokens' | 'total_tokens' | 'cost_usd'
> {
	const empty = {
		input_tokens: 0,
		output_tokens: 0,
		total_tokens: 0,
		cost_usd: 0,
	};
	if (!session_file) return empty;
	try {
		const lines = readFileSync(session_file, 'utf8').split('\n');
		for (const line of lines) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as Record<string, unknown>;
			const message = record_value(entry, 'message');
			const usage = record_value(message, 'usage');
			const cost = record_value(usage, 'cost');
			empty.input_tokens += number_value(usage.input);
			empty.output_tokens += number_value(usage.output);
			empty.total_tokens += number_value(usage.totalTokens);
			empty.cost_usd += number_value(cost.total);
		}
		if (!empty.total_tokens)
			empty.total_tokens = empty.input_tokens + empty.output_tokens;
		return empty;
	} catch {
		return empty;
	}
}

function trace_summary(
	session: DashboardSession | null,
	events: ObservabilityEvent[],
): TraceSummary {
	const ascending = events.slice().reverse();
	const spans = new Map<string, TraceSpanSummary>();
	let input_tokens = 0;
	let output_tokens = 0;
	let total_tokens = 0;
	let cost_usd = 0;

	for (const event of ascending) {
		walk_payload(event.payload, (record) => {
			const usage = record_value(record, 'usage');
			const cost = record_value(record, 'cost');
			input_tokens +=
				number_value(record.input_tokens) +
				number_value(record.prompt_tokens) +
				number_value(usage.input) +
				number_value(usage.input_tokens) +
				number_value(usage.prompt_tokens);
			output_tokens +=
				number_value(record.output_tokens) +
				number_value(record.completion_tokens) +
				number_value(usage.output) +
				number_value(usage.output_tokens) +
				number_value(usage.completion_tokens);
			total_tokens +=
				number_value(record.total_tokens) +
				number_value(usage.total_tokens) +
				number_value(usage.totalTokens);
			cost_usd +=
				number_value(record.total_cost) +
				number_value(record.cost_usd) +
				number_value(cost.total) +
				number_value(cost.total_cost) +
				number_value(cost.cost_usd);
		});
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		const id = text_value(
			payload.toolCallId ?? payload.tool_call_id ?? payload.id,
			`${event.type}:${event.seq}`,
		);
		const kind = event.type.includes('tool')
			? 'tool'
			: event.type.includes('provider')
				? 'provider'
				: event.type.includes('message')
					? 'message'
					: event.type.includes('turn')
						? 'turn'
						: 'event';
		const key =
			kind === 'event'
				? `${event.type}:${event.seq}`
				: `${kind}:${id}`;
		const span = spans.get(key) ?? {
			id: key,
			kind,
			name: span_name(event),
			start_ts: event.ts,
			end_ts: event.ts,
			duration_ms: 0,
			error: false,
			event_count: 0,
		};
		span.start_ts =
			timestamp_ms(event.ts) < timestamp_ms(span.start_ts)
				? event.ts
				: span.start_ts;
		span.end_ts =
			timestamp_ms(event.ts) > timestamp_ms(span.end_ts)
				? event.ts
				: span.end_ts;
		span.duration_ms = Math.max(
			0,
			timestamp_ms(span.end_ts) - timestamp_ms(span.start_ts),
		);
		span.error ||=
			event.type === 'error' || payload_text(event).includes('error');
		span.event_count += 1;
		spans.set(key, span);
	}
	if (!total_tokens) total_tokens = input_tokens + output_tokens;
	if (!total_tokens && !cost_usd) {
		const fallback = session_file_usage(session?.session_file);
		input_tokens = fallback.input_tokens;
		output_tokens = fallback.output_tokens;
		total_tokens = fallback.total_tokens;
		cost_usd = fallback.cost_usd;
	}
	const span_list = [...spans.values()]
		.filter((span) => span.kind !== 'event' || span.error)
		.sort((a, b) => b.duration_ms - a.duration_ms)
		.slice(0, 80);
	return {
		session,
		spans: span_list,
		metrics: {
			events: events.length,
			elapsed_ms: duration_ms(events),
			tools: span_list.filter((span) => span.kind === 'tool').length,
			errors: events.filter(
				(event) =>
					event.type === 'error' ||
					payload_text(event).includes('error'),
			).length,
			input_tokens,
			output_tokens,
			total_tokens,
			cost_usd,
			blocking_ms: span_list
				.filter(
					(span) => span.kind === 'tool' || span.kind === 'provider',
				)
				.reduce((sum, span) => sum + span.duration_ms, 0),
		},
	};
}

function valid_event(value: unknown): value is ObservabilityEvent {
	if (!value || typeof value !== 'object') return false;
	const event = value as Partial<ObservabilityEvent>;
	return (
		typeof event.event_id === 'string' &&
		typeof event.session_id === 'string' &&
		Number.isInteger(event.seq) &&
		typeof event.ts === 'string' &&
		typeof event.type === 'string'
	);
}

async function read_body(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString('utf8');
}

function escape_html(value: string): string {
	return value.replace(/[&<>]/g, (char) => {
		if (char === '&') return '&amp;';
		if (char === '<') return '&lt;';
		return '&gt;';
	});
}

function render_dashboard(db_path: string): string {
	return read_dashboard_html()
		.replaceAll('__DB_PATH__', escape_html(db_path))
		.replaceAll('__BUILD__', escape_html(SERVER_STARTED_AT));
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

	function prune_events(): void {
		statements.delete_old_events.run(options.retention_days ?? 14);
		statements.delete_over_limit_events.run(
			options.max_events ?? 100_000,
		);
		statements.delete_orphan_sessions.run();
	}

	function ingest(event: ObservabilityEvent): boolean {
		if (!valid_event(event)) return false;
		const tags_json = JSON.stringify(event.tags ?? []);
		const next_seq_row = statements.next_event_seq.get(
			event.session_id,
		) as { seq?: number } | undefined;
		const server_event = {
			...event,
			seq: next_seq_row?.seq ?? 0,
		};
		const result = statements.insert_event.run(
			server_event.event_id,
			server_event.session_id,
			server_event.seq,
			server_event.ts,
			server_event.type,
			server_event.pool ?? 'default',
			tags_json,
			JSON.stringify(server_event.payload ?? {}),
			server_event.provider ?? null,
			server_event.model ?? null,
		);
		if (result.changes === 0) return false;
		statements.upsert_session.run(
			server_event.session_id,
			server_event.pool ?? 'default',
			server_event.agent_name ?? null,
			server_event.cwd ?? '',
			server_event.session_file ?? null,
			server_event.provider ?? null,
			server_event.model ?? null,
			server_event.ts,
			server_event.ts,
			tags_json,
		);
		broadcast(server_event);
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
				return text(
					res,
					200,
					'text/html; charset=utf-8',
					render_dashboard(options.db_path),
				);
			}
			const asset = read_dashboard_asset(req_url.pathname);
			if (asset) {
				return binary(
					res,
					200,
					content_type(req_url.pathname),
					asset,
				);
			}
			if (req_url.pathname.startsWith('/fonts/')) {
				const font = read_dashboard_font(req_url.pathname);
				if (font) return binary(res, 200, 'font/woff2', font);
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
				let parsed: unknown;
				try {
					parsed = JSON.parse(await read_body(req));
				} catch {
					return json(res, 400, { error: 'invalid json' });
				}
				const events = Array.isArray(parsed) ? parsed : [parsed];
				let ingested = 0;
				db.exec('BEGIN IMMEDIATE');
				try {
					for (const event of events) if (ingest(event)) ingested++;
					if (ingested > 0) prune_events();
					db.exec('COMMIT');
				} catch (error) {
					db.exec('ROLLBACK');
					throw error;
				}
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
			const session_route = req_url.pathname.match(
				/^\/sessions\/([^/]+)\/(events|trace)$/,
			);
			if (session_route) {
				const session_id = decodeURIComponent(session_route[1]);
				const limit = Math.min(
					Number(req_url.searchParams.get('limit') ?? 500),
					1000,
				);
				const rows = statements.list_events.all(
					session_id,
					limit,
				) as Record<string, unknown>[];
				const events = rows.map(to_row_event);
				if (session_route[2] === 'events')
					return json(res, 200, { events });
				const session =
					(
						statements.list_sessions.all('', '', 500) as Record<
							string,
							unknown
						>[]
					)
						.map(to_session_row)
						.find((row) => row.session_id === session_id) ?? null;
				return json(res, 200, trace_summary(session, events));
			}
			if (req_url.pathname === '/events/search') {
				const query = req_url.searchParams.get('q') ?? '';
				const type = req_url.searchParams.get('type') ?? '';
				const session_id =
					req_url.searchParams.get('session_id') ?? '';
				const limit = Math.min(
					Number(req_url.searchParams.get('limit') ?? 200),
					1000,
				);
				const rows = statements.search_events.all(
					session_id,
					session_id,
					type,
					type,
					query,
					query ? `%${query}%` : '',
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

	server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE') {
			if (options.log) {
				const owner = describe_port_owner(options.port);
				console.error(
					`My-Pi observability port ${options.port} is already in use.`,
				);
				if (owner) console.error(`Port owner:\n${owner}`);
				console.error(
					'Stop the owner or set MY_PI_OBSERVABILITY_PORT to a free port.',
				);
			}
			return;
		}
		throw error;
	});

	server.listen(options.port, options.host, () => {
		if (!options.log) return;
		console.log(
			`My-Pi observability listening on http://${options.host}:${options.port}`,
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
