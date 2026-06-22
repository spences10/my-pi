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

export function is_authorized(
	req_url: URL,
	token: string,
	authorization?: string,
): boolean {
	if (!token) return true;
	if (req_url.searchParams.get('token') === token) return true;
	return authorization === `Bearer ${token}`;
}

export async function read_body(
	req: IncomingMessage,
): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString('utf8');
}
