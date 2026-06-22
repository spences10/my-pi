import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
	binary,
	is_authorized,
	json,
	read_body,
	text,
} from './http-responses.js';

function fake_response() {
	return {
		status: 0,
		headers: {} as Record<string, string>,
		body: undefined as unknown,
		writeHead(status: number, headers: Record<string, string>) {
			this.status = status;
			this.headers = headers;
			return this;
		},
		end(body: unknown) {
			this.body = body;
			return this;
		},
	} as any;
}

describe('http response helpers', () => {
	it('writes text, json, and binary responses with expected headers', () => {
		const text_res = fake_response();
		text(text_res, 201, 'text/plain', 'ok');
		expect(text_res).toMatchObject({
			status: 201,
			body: 'ok',
			headers: {
				'content-type': 'text/plain',
				'access-control-allow-origin': '*',
				'cache-control': 'no-store, max-age=0',
			},
		});

		const json_res = fake_response();
		json(json_res, 202, { ok: true });
		expect(json_res.body).toBe('{"ok":true}');
		expect(json_res.headers['content-type']).toBe('application/json');

		const binary_res = fake_response();
		const body = Buffer.from('asset');
		binary(binary_res, 200, 'application/octet-stream', body);
		expect(binary_res.body).toBe(body);
		expect(binary_res.headers['cache-control']).toContain(
			'immutable',
		);
	});

	it('authorizes empty tokens, query tokens, and bearer tokens', () => {
		expect(is_authorized(new URL('http://local/'), '')).toBe(true);
		expect(
			is_authorized(new URL('http://local/?token=secret'), 'secret'),
		).toBe(true);
		expect(
			is_authorized(
				new URL('http://local/'),
				'secret',
				'Bearer secret',
			),
		).toBe(true);
		expect(
			is_authorized(new URL('http://local/?token=nope'), 'secret'),
		).toBe(false);
	});

	it('reads streaming request bodies as utf8', async () => {
		const req = Readable.from([
			Buffer.from('hello '),
			'world',
		]) as any;

		await expect(read_body(req)).resolves.toBe('hello world');
	});
});
