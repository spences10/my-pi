#!/usr/bin/env node
import {
	SqliteBusyError,
	with_sqlite_transaction,
} from '@spences10/pi-sqlite-core';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
	content_type,
	read_dashboard_asset,
	read_dashboard_font,
	render_dashboard,
} from './assets.js';
import { prepare_db } from './db.js';
import {
	to_row_event,
	to_session_row,
	valid_event,
} from './event-rows.js';
import {
	binary,
	BodyTooLargeError,
	is_authorized,
	json,
	read_body,
	text,
} from './http-responses.js';
import { resolve_observability_server_options } from './options.js';
import { describe_port_owner } from './port-owner.js';
import type {
	ObservabilityServerOptions,
	RunningObservabilityServer,
} from './server-options.js';
import { resolve_session_name } from './session-name.js';
import { trace_summary } from './trace-summary.js';
import type { ObservabilityEvent } from './types.js';

export { resolve_observability_server_options } from './options.js';
export type {
	ObservabilityServerOptions,
	RunningObservabilityServer,
} from './server-options.js';

interface Subscriber {
	id: number;
	res: ServerResponse;
	pool?: string;
	tag?: string;
	session_id?: string;
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const MAX_TRACE_EVENTS = 10_000;

function bounded_limit(
	value: string | null,
	fallback: number,
	maximum: number,
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed) || parsed < 1) return fallback;
	return Math.min(parsed, maximum);
}

export function start_observability_server(
	options: ObservabilityServerOptions = resolve_observability_server_options(),
): RunningObservabilityServer {
	const { db, statements } = prepare_db(options.db_path);
	let next_subscriber_id = 1;
	const subscribers = new Map<number, Subscriber>();

	function write_subscriber(sub: Subscriber, frame: string): void {
		try {
			if (sub.res.destroyed || !sub.res.write(frame)) {
				subscribers.delete(sub.id);
				sub.res.destroy();
			}
		} catch {
			subscribers.delete(sub.id);
			sub.res.destroy();
		}
	}

	function close_subscribers(): void {
		for (const sub of subscribers.values()) {
			sub.res.end();
		}
		subscribers.clear();
	}

	function broadcast(event: ObservabilityEvent): void {
		const frame = `event: event\ndata: ${JSON.stringify(event)}\n\n`;
		for (const sub of subscribers.values()) {
			if (sub.pool && sub.pool !== event.pool) continue;
			if (sub.tag && !event.tags.includes(sub.tag)) continue;
			if (sub.session_id && sub.session_id !== event.session_id)
				continue;
			write_subscriber(sub, frame);
		}
	}

	function prune_events(): void {
		statements.delete_old_events.run(options.retention_days ?? 14);
		statements.delete_over_limit_events.run(
			options.max_events ?? 100_000,
		);
		statements.delete_orphan_sessions.run();
	}

	function ingest(
		event: ObservabilityEvent,
	): ObservabilityEvent | null {
		if (!valid_event(event)) return null;
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
		if (result.changes === 0) return null;
		statements.upsert_session.run(
			server_event.session_id,
			server_event.pool ?? 'default',
			server_event.agent_name ?? null,
			server_event.session_name ?? null,
			server_event.cwd ?? '',
			server_event.session_file ?? null,
			server_event.provider ?? null,
			server_event.model ?? null,
			server_event.ts,
			server_event.ts,
			tags_json,
		);
		return server_event;
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
					parsed = JSON.parse(
						await read_body(
							req,
							options.max_body_bytes ?? DEFAULT_MAX_BODY_BYTES,
						),
					);
				} catch (error) {
					if (error instanceof BodyTooLargeError) {
						return json(res, 413, {
							error: 'request body too large',
							max_bytes: error.max_bytes,
						});
					}
					return json(res, 400, { error: 'invalid json' });
				}
				const events = Array.isArray(parsed) ? parsed : [parsed];
				const ingested_events = with_sqlite_transaction(
					db,
					() => {
						const attempt_events: ObservabilityEvent[] = [];
						for (const event of events) {
							const server_event = ingest(event);
							if (server_event) attempt_events.push(server_event);
						}
						if (attempt_events.length > 0) prune_events();
						return attempt_events;
					},
					{
						immediate: true,
						operation: 'Ingest observability events',
					},
				);
				for (const event of ingested_events) broadcast(event);
				return json(res, 200, {
					ingested: ingested_events.length,
					rejected: events.length - ingested_events.length,
				});
			}
			if (req_url.pathname === '/sessions') {
				const limit = bounded_limit(
					req_url.searchParams.get('limit'),
					100,
					500,
				);
				const pool = req_url.searchParams.get('pool') ?? '';
				const rows = statements.list_sessions.all(
					pool,
					pool,
					limit,
				) as Record<string, unknown>[];
				const tag = req_url.searchParams.get('tag');
				const sessions = rows
					.map(to_session_row)
					.map(resolve_session_name)
					.filter((row) => {
						if (!tag) return true;
						return row.tags?.includes(tag);
					});
				return json(res, 200, { sessions });
			}
			const session_route = req_url.pathname.match(
				/^\/sessions\/([^/]+)\/(events|trace)$/,
			);
			if (session_route) {
				const session_id = decodeURIComponent(session_route[1]);
				const is_trace = session_route[2] === 'trace';
				const limit = bounded_limit(
					req_url.searchParams.get('limit'),
					is_trace ? MAX_TRACE_EVENTS : 500,
					is_trace ? MAX_TRACE_EVENTS : 1000,
				);
				const rows = statements.list_events.all(
					session_id,
					limit,
				) as Record<string, unknown>[];
				const events = rows.map(to_row_event);
				if (!is_trace) return json(res, 200, { events });
				const session_row = statements.get_session.get(session_id) as
					| Record<string, unknown>
					| undefined;
				const session = session_row
					? resolve_session_name(to_session_row(session_row))
					: null;
				return json(res, 200, trace_summary(session, events));
			}
			if (req_url.pathname === '/events/search') {
				const query = req_url.searchParams.get('q') ?? '';
				const type = req_url.searchParams.get('type') ?? '';
				const session_id =
					req_url.searchParams.get('session_id') ?? '';
				const limit = bounded_limit(
					req_url.searchParams.get('limit'),
					200,
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
				write_subscriber(
					subscribers.get(id)!,
					'retry: 2000\nevent: hello\ndata: {}\n\n',
				);
				req.on('close', () => subscribers.delete(id));
				return;
			}
			return json(res, 404, { error: 'not found' });
		} catch (error) {
			return json(res, error instanceof SqliteBusyError ? 503 : 500, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	const heartbeat = setInterval(() => {
		for (const sub of subscribers.values())
			write_subscriber(sub, ': ping\n\n');
	}, 15_000);

	server.requestTimeout = REQUEST_TIMEOUT_MS;
	server.headersTimeout = HEADERS_TIMEOUT_MS;
	server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

	server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE' && options.log) {
			const owner = describe_port_owner(options.port);
			console.error(
				`My-Pi observability port ${options.port} is already in use.`,
			);
			if (owner) console.error(`Port owner:\n${owner}`);
			console.error(
				'Stop the owner or set MY_PI_OBSERVABILITY_PORT to a free port.',
			);
		}
		clearInterval(heartbeat);
		close_subscribers();
		db.close();
		if (options.throw_on_listen_error !== false) throw error;
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
			close_subscribers();
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
