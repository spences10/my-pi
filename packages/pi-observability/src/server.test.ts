import { mkdtempSync } from 'node:fs';
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
		ts: new Date(Date.UTC(2026, 5, 1, 0, 0, seq)).toISOString(),
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
		expect(html).toContain('/dashboard.css');
		expect(html).toContain('/dashboard.js');

		const css = await (
			await fetch(`${server.url}/dashboard.css`)
		).text();
		const js = await (
			await fetch(`${server.url}/dashboard.js`)
		).text();
		expect(css).toContain('.layout');
		expect(html).toContain('Filter sessions, pools, models');
		expect(js).toContain('pause_btn');
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
