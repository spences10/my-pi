import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function text(
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

export function json(
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

export function binary(
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

function token_digest(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

export function is_authorized(
	token: string,
	authorization?: string,
): boolean {
	if (!token || !authorization?.startsWith('Bearer ')) return false;
	const provided = authorization.slice('Bearer '.length);
	if (!provided) return false;
	return timingSafeEqual(token_digest(token), token_digest(provided));
}

export class BodyTooLargeError extends Error {
	constructor(readonly max_bytes: number) {
		super(`request body exceeds ${max_bytes} bytes`);
		this.name = 'BodyTooLargeError';
	}
}

export async function read_body(
	req: IncomingMessage,
	max_bytes = 1_048_576,
): Promise<string> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.byteLength;
		if (total > max_bytes) throw new BodyTooLargeError(max_bytes);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString('utf8');
}
