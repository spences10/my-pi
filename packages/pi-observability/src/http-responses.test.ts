import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	binary,
	is_authorized,
	json,
	read_body,
	text,
} from './http-responses.js';

function fake_response() {
	const response = new ServerResponse(
		new IncomingMessage(new Socket()),
	);

	const write_head = vi
		.spyOn(response, 'writeHead')
		.mockImplementation(() => response);

	const end = vi
		.spyOn(response, 'end')
		.mockImplementation(() => response);

	return {
		response,
		status: () => write_head.mock.calls[0]?.[0],
		headers: () => write_head.mock.calls[0]?.[1],
		body: () => end.mock.calls[0]?.[0],
	};
}

describe('http response helpers', () => {
	it('writes text, json, and binary responses with expected headers', () => {
		const text_res = fake_response();
		text(text_res.response, 201, 'text/plain', 'ok');
		expect(text_res.status()).toBe(201);
		expect(text_res.body()).toBe('ok');
		expect(text_res.headers()).toMatchObject({
			'content-type': 'text/plain',
			'access-control-allow-origin': '*',
			'cache-control': 'no-store, max-age=0',
		});

		const json_res = fake_response();
		json(json_res.response, 202, { ok: true });
		expect(json_res.body()).toBe('{"ok":true}');
		expect(json_res.headers()).toMatchObject({
			'content-type': 'application/json',
		});

		const binary_res = fake_response();
		const body = Buffer.from('asset');
		binary(
			binary_res.response,
			200,
			'application/octet-stream',
			body,
		);
		expect(binary_res.body()).toBe(body);
		expect(binary_res.headers()).toMatchObject({
			'cache-control': expect.stringContaining('immutable'),
		});
	});

	it('fails closed and accepts only an exact bearer header', () => {
		expect(is_authorized('', undefined)).toBe(false);
		expect(is_authorized('expected-value', undefined)).toBe(false);
		expect(
			is_authorized('expected-value', 'Bearer expected-value'),
		).toBe(true);
		expect(
			is_authorized('expected-value', 'Bearer different-value'),
		).toBe(false);
		expect(
			is_authorized('expected-value', 'Basic expected-value'),
		).toBe(false);
	});

	it('reads streaming request bodies as utf8', async () => {
		const req = new IncomingMessage(new Socket());
		req.push(Buffer.from('hello '));
		req.push('world');
		req.push(null);

		await expect(read_body(req)).resolves.toBe('hello world');
	});
});
