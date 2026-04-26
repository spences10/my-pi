import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClient } from './client.js';

function read_json(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : null);
			} catch (error) {
				reject(error);
			}
		});
		req.on('error', reject);
	});
}

function write_sse(res: ServerResponse, message: unknown) {
	res.write(`data: ${JSON.stringify(message)}\n\n`);
	res.end();
}

describe('McpClient http transport', () => {
	const servers: Array<{ close: () => Promise<void> }> = [];

	afterEach(async () => {
		while (servers.length > 0) {
			await servers.pop()!.close();
		}
	});

	it('connects to http MCP servers and reuses session ids', async () => {
		const seen_session_headers: string[] = [];
		const server = createServer(async (req, res) => {
			const session_header = req.headers['mcp-session-id'];
			seen_session_headers.push(
				typeof session_header === 'string' ? session_header : '',
			);
			if (req.method === 'DELETE') {
				res.statusCode = 204;
				res.end();
				return;
			}
			const message = await read_json(req);
			res.setHeader('content-type', 'application/json');
			if (message.method === 'initialize') {
				res.setHeader('mcp-session-id', 'session-123');
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							protocolVersion: '2024-11-05',
							capabilities: {},
							serverInfo: { name: 'test-server', version: '1.0.0' },
						},
					}),
				);
				return;
			}
			if (message.method === 'notifications/initialized') {
				res.statusCode = 204;
				res.end();
				return;
			}
			if (message.method === 'tools/list') {
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							tools: [
								{
									name: 'ping',
									description: 'Ping tool',
									inputSchema: { type: 'object', properties: {} },
								},
							],
						},
					}),
				);
				return;
			}
			if (message.method === 'tools/call') {
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							content: [{ type: 'text', text: 'pong' }],
						},
					}),
				);
			}
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		servers.push({
			close: () =>
				new Promise<void>((resolve, reject) =>
					server.close((error) =>
						error ? reject(error) : resolve(),
					),
				),
		});

		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Expected TCP server address');
		}

		const client = new McpClient({
			name: 'remote',
			transport: 'http',
			url: `http://127.0.0.1:${address.port}/mcp`,
			headers: { Authorization: 'Bearer test' },
		});
		await client.connect();
		await expect(client.listTools()).resolves.toEqual([
			{
				name: 'ping',
				description: 'Ping tool',
				inputSchema: { type: 'object', properties: {} },
			},
		]);
		await expect(client.callTool('ping', {})).resolves.toEqual({
			content: [{ type: 'text', text: 'pong' }],
		});
		await client.disconnect();

		expect(seen_session_headers).toEqual([
			'',
			'session-123',
			'session-123',
			'session-123',
			'session-123',
		]);
	});

	it('parses SSE responses from http MCP servers', async () => {
		const server = createServer(async (req, res) => {
			const message = await read_json(req);
			if (message.method === 'initialize') {
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							protocolVersion: '2024-11-05',
							capabilities: {},
							serverInfo: { name: 'test-server', version: '1.0.0' },
						},
					}),
				);
				return;
			}
			if (message.method === 'notifications/initialized') {
				res.statusCode = 204;
				res.end();
				return;
			}
			res.setHeader('content-type', 'text/event-stream');
			write_sse(res, {
				jsonrpc: '2.0',
				id: message.id,
				result: {
					tools: [
						{
							name: 'sse-tool',
							inputSchema: { type: 'object', properties: {} },
						},
					],
				},
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		servers.push({
			close: () =>
				new Promise<void>((resolve, reject) =>
					server.close((error) =>
						error ? reject(error) : resolve(),
					),
				),
		});

		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Expected TCP server address');
		}

		const client = new McpClient({
			name: 'remote',
			transport: 'http',
			url: `http://127.0.0.1:${address.port}/mcp`,
		});
		await client.connect();
		await expect(client.listTools()).resolves.toEqual([
			{
				name: 'sse-tool',
				inputSchema: { type: 'object', properties: {} },
			},
		]);
	});
});
