import { spawn, type ChildProcess } from 'node:child_process';
import { create_child_process_env } from './env.js';

interface McpServerTrustMetadata {
	/**
	 * False when the server came from a project mcp.json that was allowed for
	 * this session but not trusted. Tool descriptions and schema prose from
	 * such servers must not be exposed to the model.
	 */
	metadata_trusted?: false;
}

export interface McpStdioServerConfig extends McpServerTrustMetadata {
	name: string;
	transport: 'stdio';
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpHttpServerConfig extends McpServerTrustMetadata {
	name: string;
	transport: 'http';
	url: string;
	headers?: Record<string, string>;
}

export type McpServerConfig =
	| McpStdioServerConfig
	| McpHttpServerConfig;

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: number;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc?: '2.0';
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export class McpClient {
	#proc: ChildProcess | null = null;
	#config: McpServerConfig;
	#nextId = 1;
	#pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}
	>();
	#buffer = '';
	#sessionId?: string;

	constructor(config: McpServerConfig) {
		this.#config = config;
	}

	async connect(): Promise<void> {
		if (this.#config.transport === 'stdio') {
			await this.#connect_stdio();
		}

		await this.#request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'my-pi', version: '0.0.1' },
		});

		await this.#send({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		});
	}

	async listTools(): Promise<McpToolInfo[]> {
		const result = (await this.#request('tools/list', {})) as {
			tools: McpToolInfo[];
		};
		return result.tools;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		return this.#request('tools/call', {
			name,
			arguments: args,
		});
	}

	async disconnect(): Promise<void> {
		if (this.#config.transport === 'http') {
			await this.#disconnect_http();
		}
		if (this.#proc) {
			this.#proc.kill();
			this.#proc = null;
		}
		this.#pending.clear();
	}

	async #connect_stdio(): Promise<void> {
		const {
			command,
			args = [],
			env,
		} = this.#config as McpStdioServerConfig;

		this.#proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_child_process_env(env),
		});

		this.#proc.stdout!.setEncoding('utf8');
		this.#proc.stdout!.on('data', (chunk: string) => {
			this.#buffer += chunk;
			const lines = this.#buffer.split('\n');
			this.#buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					this.#handle_message(JSON.parse(line) as JsonRpcResponse);
				} catch {
					// ignore non-JSON lines
				}
			}
		});
	}

	#request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = this.#nextId++;
			this.#pending.set(id, { resolve, reject });
			this.#send({ jsonrpc: '2.0', id, method, params }).catch(
				(error) => {
					if (this.#pending.has(id)) {
						this.#pending.delete(id);
						reject(error as Error);
					}
				},
			);

			setTimeout(() => {
				if (this.#pending.has(id)) {
					this.#pending.delete(id);
					reject(new Error(`MCP request ${method} timed out`));
				}
			}, 30_000);
		});
	}

	async #send(msg: JsonRpcRequest): Promise<void> {
		if (this.#config.transport === 'http') {
			await this.#send_http(msg);
			return;
		}

		if (!this.#proc?.stdin?.writable) {
			throw new Error('MCP server not connected');
		}
		this.#proc.stdin.write(JSON.stringify(msg) + '\n');
	}

	async #send_http(msg: JsonRpcRequest): Promise<void> {
		const config = this.#config as McpHttpServerConfig;
		const headers = new Headers(config.headers ?? {});
		headers.set('content-type', 'application/json');
		headers.set('accept', 'application/json, text/event-stream');
		if (this.#sessionId) {
			headers.set('mcp-session-id', this.#sessionId);
		}

		const response = await fetch(config.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(msg),
		});

		const sessionId = response.headers.get('mcp-session-id');
		if (sessionId) {
			this.#sessionId = sessionId;
		}

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(
				`MCP HTTP ${response.status}${body ? `: ${body}` : ''}`,
			);
		}

		if (response.status === 204) return;

		const contentType = response.headers.get('content-type') ?? '';
		if (contentType.includes('text/event-stream')) {
			await this.#consume_sse_response(response, config.name);
			return;
		}

		const body = await response.text();
		if (!body.trim()) return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new Error(
				`Invalid MCP HTTP response from ${config.name}: ${body.slice(0, 200)}`,
			);
		}
		this.#dispatch_message(parsed);
	}

	async #disconnect_http(): Promise<void> {
		const config = this.#config as McpHttpServerConfig;
		if (!this.#sessionId) return;

		const headers = new Headers(config.headers ?? {});
		headers.set('mcp-session-id', this.#sessionId);
		const response = await fetch(config.url, {
			method: 'DELETE',
			headers,
		});
		if (response.status !== 405 && !response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(
				`MCP HTTP disconnect ${response.status}${body ? `: ${body}` : ''}`,
			);
		}
		this.#sessionId = undefined;
	}

	async #consume_sse_response(
		response: Response,
		server_name: string,
	): Promise<void> {
		if (!response.body) return;

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let event_lines: string[] = [];

		const flush_event = () => {
			if (event_lines.length === 0) return;
			const data_lines = event_lines
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart());
			event_lines = [];
			if (data_lines.length === 0) return;
			const payload = data_lines.join('\n').trim();
			if (!payload) return;

			try {
				this.#dispatch_message(JSON.parse(payload));
			} catch {
				throw new Error(
					`Invalid MCP SSE payload from ${server_name}: ${payload.slice(0, 200)}`,
				);
			}
		};

		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value ?? new Uint8Array(), {
				stream: !done,
			});
			const normalized = buffer.replace(/\r\n/g, '\n');
			const lines = normalized.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (line === '') {
					flush_event();
					continue;
				}
				if (line.startsWith(':')) continue;
				event_lines.push(line);
			}

			if (done) break;
		}

		if (buffer.trim()) {
			event_lines.push(buffer.trim());
		}
		flush_event();
	}

	#dispatch_message(message: unknown): void {
		if (Array.isArray(message)) {
			for (const item of message) {
				this.#dispatch_message(item);
			}
			return;
		}
		if (!message || typeof message !== 'object') return;
		this.#handle_message(message as JsonRpcResponse);
	}

	#handle_message(msg: JsonRpcResponse): void {
		if (msg.id == null || !this.#pending.has(msg.id)) return;
		const pending = this.#pending.get(msg.id)!;
		this.#pending.delete(msg.id);
		if (msg.error) {
			pending.reject(
				new Error(
					`MCP error ${msg.error.code}: ${msg.error.message}`,
				),
			);
			return;
		}
		pending.resolve(msg.result);
	}
}
