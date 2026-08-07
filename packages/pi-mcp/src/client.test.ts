import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { execPath } from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';

function read_json(req: IncomingMessage): Promise<{
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
}> {
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

describe('McpClient stdio transport failures', () => {
	it('fails quickly when the server binary cannot be spawned', async () => {
		const client = new McpClient({
			name: 'missing',
			transport: 'stdio',
			command: '__my_pi_missing_mcp_binary__',
			request_timeout_ms: 100,
		});

		await expect(client.connect()).rejects.toThrow(
			/MCP server missing failed to start|MCP server not connected/,
		);
	});

	it('fails when a stdio server exits before responding', async () => {
		const client = new McpClient({
			name: 'bad-output',
			transport: 'stdio',
			command: execPath,
			args: ['-e', 'console.log("not json");'],
			request_timeout_ms: 1_000,
		});

		await expect(client.connect()).rejects.toThrow(
			/MCP server bad-output exited before responding/,
		);
	});

	it('times out when a stdio server never responds', async () => {
		const client = new McpClient({
			name: 'silent',
			transport: 'stdio',
			command: execPath,
			args: ['-e', 'setTimeout(() => {}, 10_000);'],
			request_timeout_ms: 50,
		});

		await expect(client.connect()).rejects.toThrow(
			/MCP request initialize timed out/,
		);
		await client.disconnect();
	});
});

describe('McpClient http transport', () => {
	const servers: Array<{ close: () => Promise<void> }> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
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
			if (message.method === 'server/discover') {
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						error: { code: -32601, message: 'Method not found' },
					}),
				);
				return;
			}
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

		const clear_timeout = vi.spyOn(globalThis, 'clearTimeout');
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

		expect(clear_timeout).toHaveBeenCalled();
		clear_timeout.mockRestore();
		expect(seen_session_headers).toEqual([
			'',
			'',
			'session-123',
			'session-123',
			'session-123',
			'session-123',
		]);
	});

	it('uses stateless modern requests and honors tool-list cache hints', async () => {
		const requests: Array<{
			method?: string;
			params?: Record<string, unknown>;
			headers: IncomingMessage['headers'];
		}> = [];
		let list_count = 0;
		const server = createServer(async (req, res) => {
			const message = await read_json(req);
			requests.push({
				method: message.method,
				params: message.params,
				headers: req.headers,
			});
			res.setHeader('content-type', 'application/json');
			if (message.method === 'server/discover') {
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							resultType: 'complete',
							supportedVersions: ['2026-07-28'],
							capabilities: { tools: {} },
							serverInfo: { name: 'modern', version: '1.0.0' },
						},
					}),
				);
				return;
			}
			if (message.method === 'tools/list') {
				list_count += 1;
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: {
							resultType: 'complete',
							tools: [
								{ name: 'ping', inputSchema: { type: 'object' } },
							],
							ttlMs: 60_000,
							cacheScope: 'private',
						},
					}),
				);
				return;
			}
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id: message.id,
					result: {
						resultType: 'complete',
						content: [{ type: 'text', text: 'pong' }],
					},
				}),
			);
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
			name: 'modern',
			transport: 'http',
			url: `http://127.0.0.1:${address.port}/mcp`,
		});
		await client.connect();
		await client.listTools();
		await client.listTools();
		await client.callTool('ping', {});
		await client.disconnect();

		expect(list_count).toBe(1);
		expect(requests.map(({ method }) => method)).toEqual([
			'server/discover',
			'tools/list',
			'tools/call',
		]);
		for (const request of requests) {
			expect(request.headers['mcp-protocol-version']).toBe(
				'2026-07-28',
			);
			expect(request.headers['mcp-method']).toBe(request.method);
			expect(request.headers['mcp-session-id']).toBeUndefined();
			expect(request.params?._meta).toMatchObject({
				'io.modelcontextprotocol/protocolVersion': '2026-07-28',
				'io.modelcontextprotocol/clientCapabilities': {},
				'io.modelcontextprotocol/clientInfo': {
					name: 'my-pi',
					version: '0.0.1',
				},
			});
		}
		expect(requests[2]?.headers['mcp-name']).toBe('ping');
	});

	it('parses SSE responses from http MCP servers', async () => {
		const server = createServer(async (req, res) => {
			const message = await read_json(req);
			if (message.method === 'server/discover') {
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						error: { code: -32601, message: 'Method not found' },
					}),
				);
				return;
			}
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
