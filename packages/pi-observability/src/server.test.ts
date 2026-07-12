import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	resolve_observability_server_options,
	start_observability_server,
	type RunningObservabilityServer,
} from './server.js';
import type { ObservabilityEvent } from './types.js';

const servers: RunningObservabilityServer[] = [];

afterEach(async () => {
	while (servers.length > 0) {
		await servers.pop()?.close();
	}
});

function tmp_db_path(): string {
	return join(mkdtempSync(join(tmpdir(), 'pi-obs-')), 'obs.db');
}

function test_port(): number {
	return 44_000 + Math.floor(Math.random() * 1_000);
}

async function wait_for_health(url: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			const response = await fetch(`${url}/health`);
			if (response.ok) return;
		} catch {
			// wait and retry
		}
		await new Promise((resolve_wait) => setTimeout(resolve_wait, 20));
	}
	throw new Error('server did not start');
}

function event(seq = 0): ObservabilityEvent {
	return {
		event_id: `evt-${seq}`,
		ts: new Date(Date.now() + seq * 1000).toISOString(),
		type: 'session_start',
		session_id: 'session-1',
		cwd: '/tmp/project',
		pool: 'pool-a',
		tags: ['tag-a'],
		seq,
		payload: { reason: 'startup' },
	};
}

describe('resolve_observability_server_options', () => {
	it('uses environment overrides', () => {
		expect(
			resolve_observability_server_options({
				MY_PI_OBSERVABILITY_HOST: '0.0.0.0',
				MY_PI_OBSERVABILITY_PORT: '1234',
				MY_PI_OBSERVABILITY_DB: '/tmp/obs.db',
				MY_PI_OBSERVABILITY_TOKEN: 'secret',
				MY_PI_OBSERVABILITY_LOG: '0',
			}),
		).toEqual({
			host: '0.0.0.0',
			port: 1234,
			db_path: '/tmp/obs.db',
			token: 'secret',
			log: false,
			retention_days: 14,
			max_events: 100_000,
			max_body_bytes: 1_048_576,
		});
	});

	it('falls back when the environment port is invalid', () => {
		expect(
			resolve_observability_server_options({
				MY_PI_OBSERVABILITY_PORT: 'not-a-port',
			}).port,
		).toBe(43190);
	});
});

describe('start_observability_server', () => {
	it('ingests events and exposes session history', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		const ingest_response = await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify([event(0), event(1)]),
		});
		expect(await ingest_response.json()).toMatchObject({
			ingested: 2,
			rejected: 0,
		});

		const sessions_response = await fetch(`${server.url}/sessions`);
		const sessions_body = (await sessions_response.json()) as {
			sessions: Array<{ session_id: string; event_count: number }>;
		};
		expect(sessions_body.sessions[0]).toMatchObject({
			session_id: 'session-1',
			event_count: 2,
		});

		const events_response = await fetch(
			`${server.url}/sessions/session-1/events`,
		);
		const events_body = (await events_response.json()) as {
			events: ObservabilityEvent[];
		};
		expect(events_body.events.map((item) => item.seq)).toEqual([
			1, 0,
		]);

		const trace_response = await fetch(
			`${server.url}/sessions/session-1/trace`,
		);
		const trace_body = (await trace_response.json()) as {
			metrics: { events: number };
		};
		expect(trace_body.metrics.events).toBe(2);
	});

	it('falls back to session files for summarized historic usage', async () => {
		const session_file = join(
			mkdtempSync(join(tmpdir(), 'pi-obs-session-')),
			'session.jsonl',
		);
		writeFileSync(
			session_file,
			`${JSON.stringify({
				type: 'message',
				message: {
					usage: {
						input: 2000,
						output: 50,
						totalTokens: 2050,
						cost: { total: 0.01 },
					},
				},
			})}\n`,
		);
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				...event(0),
				session_file,
				type: 'message_end',
				payload: { message: { type: 'object', keys: ['usage'] } },
			}),
		});

		const trace_response = await fetch(
			`${server.url}/sessions/session-1/trace`,
		);
		const trace_body = (await trace_response.json()) as {
			metrics: {
				input_tokens: number;
				output_tokens: number;
				total_tokens: number;
				cost_usd: number;
			};
		};
		expect(trace_body.metrics).toMatchObject({
			input_tokens: 2000,
			output_tokens: 50,
			total_tokens: 2050,
			cost_usd: 0.01,
		});
	});

	it('rolls up token and cost metrics from message usage payloads', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				...event(0),
				type: 'message_end',
				payload: {
					message: {
						usage: {
							input: 1000,
							output: 25,
							totalTokens: 1025,
							cost: { total: 0.005 },
						},
					},
				},
			}),
		});

		const trace_response = await fetch(
			`${server.url}/sessions/session-1/trace`,
		);
		const trace_body = (await trace_response.json()) as {
			metrics: {
				input_tokens: number;
				output_tokens: number;
				total_tokens: number;
				cost_usd: number;
			};
		};
		expect(trace_body.metrics).toMatchObject({
			input_tokens: 1000,
			output_tokens: 25,
			total_tokens: 1025,
			cost_usd: 0.005,
		});
	});

	it('resolves an existing session name from its JSONL source', async () => {
		const db_path = tmp_db_path();
		const session_file = join(
			mkdtempSync(join(tmpdir(), 'pi-obs-session-')),
			'session.jsonl',
		);
		writeFileSync(
			session_file,
			`${JSON.stringify({ type: 'session_info', name: 'derek' })}\n${`${JSON.stringify({ type: 'message', text: 'x'.repeat(1024) })}\n`.repeat(300)}`,
		);
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path,
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);
		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...event(), session_file }),
		});

		const response = await fetch(`${server.url}/sessions`);
		const body = (await response.json()) as {
			sessions: Array<{ session_name?: string }>;
		};
		expect(body.sessions[0]?.session_name).toBe('derek');
	});

	it('persists a live session rename separately from agent_name', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);
		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				...event(),
				agent_name: 'worker-a',
				session_name: 'derek',
				type: 'session_info_changed',
			}),
		});

		const response = await fetch(`${server.url}/sessions`);
		const body = (await response.json()) as {
			sessions: Array<{ agent_name?: string; session_name?: string }>;
		};
		expect(body.sessions[0]).toMatchObject({
			agent_name: 'worker-a',
			session_name: 'derek',
		});
	});

	it('serves the dashboard shell', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		const response = await fetch(server.url);
		const html = await response.text();
		expect(html).toContain('Pi Observability');
		expect(html).toContain('<div id="app"></div>');
	});

	it('rejects malformed event requests without crashing', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		expect(
			(
				await fetch(`${server.url}/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{',
				})
			).status,
		).toBe(400);

		expect(
			await (
				await fetch(`${server.url}/events`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ nope: true }),
				})
			).json(),
		).toMatchObject({ ingested: 0, rejected: 1 });
	});

	it('rejects event bodies over the configured cap', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
			max_body_bytes: 16,
		});
		servers.push(server);
		await wait_for_health(server.url);

		const response = await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(event(0)),
		});

		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({
			error: 'request body too large',
			max_bytes: 16,
		});
	});

	it('assigns durable server sequence numbers across resumed client sequences', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify([
				event(0),
				{ ...event(0), event_id: 'evt-resume-0' },
				{ ...event(1), event_id: 'evt-resume-1' },
			]),
		});

		const events_response = await fetch(
			`${server.url}/sessions/session-1/events`,
		);
		const events_body = (await events_response.json()) as {
			events: ObservabilityEvent[];
		};
		expect(events_body.events.map((item) => item.seq)).toEqual([
			2, 1, 0,
		]);
	});

	it('prunes events beyond the configured retention cap', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
			max_events: 10,
			retention_days: 14,
		});
		servers.push(server);
		await wait_for_health(server.url);

		const events = Array.from({ length: 101 }, (_, seq) =>
			event(seq),
		);
		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(events),
		});

		const events_response = await fetch(
			`${server.url}/sessions/session-1/events?limit=200`,
		);
		const events_body = (await events_response.json()) as {
			events: ObservabilityEvent[];
		};
		expect(events_body.events).toHaveLength(10);
		expect(events_body.events[0]?.seq).toBe(100);
	});

	it('requires auth when a token is configured', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: 'dev-token',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		expect((await fetch(`${server.url}/sessions`)).status).toBe(401);
		expect(
			(await fetch(`${server.url}/sessions?token=dev-token`)).status,
		).toBe(200);
	});

	it('broadcasts ingested events to SSE subscribers', async () => {
		const server = start_observability_server({
			host: '127.0.0.1',
			port: test_port(),
			token: '',
			db_path: tmp_db_path(),
			log: false,
		});
		servers.push(server);
		await wait_for_health(server.url);

		const controller = new AbortController();
		const stream_response = await fetch(
			`${server.url}/events/stream`,
			{
				signal: controller.signal,
			},
		);
		const reader = stream_response.body?.getReader();
		if (!reader) throw new Error('missing stream reader');
		const decoder = new TextDecoder();
		let text = '';
		text += decoder.decode((await reader.read()).value);

		await fetch(`${server.url}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(event(0)),
		});

		for (let attempt = 0; attempt < 20; attempt++) {
			text += decoder.decode((await reader.read()).value);
			if (text.includes('event: event')) break;
		}
		controller.abort();
		expect(text).toContain('event: hello');
		expect(text).toContain('event: event');
		expect(text).toContain('session-1');
	});
});
