import { spawn, type ChildProcess } from 'node:child_process';
import { create_child_process_env } from './env.js';

interface McpServerTrustMetadata {
	/**
	 * False when the server came from a project mcp.json that was allowed for
	 * this session but not trusted. Tool descriptions and schema prose from
	 * such servers must not be exposed to the model.
	 */
	metadata_trusted?: false;
	/** Disabled in MCP config. Kept visible so `/mcp` can re-enable it. */
	disabled?: boolean;
	/** Request timeout in milliseconds. Primarily used by tests. */
	request_timeout_ms?: number;
	/** Disconnect an idle connected server after this many milliseconds. */
	idle_timeout_ms?: number;
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
	error?: { code: number; message: string; data?: unknown };
}

interface McpDiscoverResult {
	supportedVersions: string[];
	capabilities?: Record<string, unknown>;
	serverInfo?: { name: string; version: string };
}

interface McpCacheableResult {
	resultType?: 'complete' | 'input_required';
	ttlMs?: number;
	cacheScope?: 'public' | 'private';
}

class McpProtocolError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(`MCP error ${code}: ${message}`);
	}
}

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_PROTOCOL_VERSION = '2024-11-05';
const UNSUPPORTED_PROTOCOL_VERSION_ERROR = -32022;
const CLIENT_INFO = { name: 'my-pi', version: '0.0.1' } as const;

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
			timer: NodeJS.Timeout;
		}
	>();
	#buffer = '';
	#sessionId?: string;
	#closedError?: Error;
	#protocolEra?: 'modern' | 'legacy';
	#protocolVersion?: string;
	#toolsCache?: { tools: McpToolInfo[]; expiresAt: number };

	constructor(config: McpServerConfig) {
		this.#config = config;
	}

	async connect(): Promise<void> {
		if (this.#config.transport === 'stdio') {
			await this.#connect_stdio();
		}

		try {
			const discovered = (await this.#request(
				'server/discover',
				{},
				MODERN_PROTOCOL_VERSION,
			)) as McpDiscoverResult;
			if (
				!discovered.supportedVersions?.includes(
					MODERN_PROTOCOL_VERSION,
				)
			) {
				throw new Error(
					`MCP server ${this.#config.name} does not support ${MODERN_PROTOCOL_VERSION}`,
				);
			}
			this.#protocolEra = 'modern';
			this.#protocolVersion = MODERN_PROTOCOL_VERSION;
			return;
		} catch (error) {
			if (this.#is_unsupported_protocol_error(error)) {
				const supported = this.#get_supported_versions(error);
				if (!supported.includes(MODERN_PROTOCOL_VERSION)) throw error;
				this.#protocolEra = 'modern';
				this.#protocolVersion = MODERN_PROTOCOL_VERSION;
				return;
			}
			if (this.#is_modern_protocol_error(error)) throw error;
		}

		this.#protocolEra = 'legacy';
		this.#protocolVersion = LEGACY_PROTOCOL_VERSION;
		await this.#request('initialize', {
			protocolVersion: LEGACY_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO,
		});
		await this.#send({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		});
	}

	async listTools(): Promise<McpToolInfo[]> {
		if (this.#toolsCache && this.#toolsCache.expiresAt > Date.now()) {
			return this.#toolsCache.tools;
		}
		const result = (await this.#request('tools/list', {})) as {
			tools: McpToolInfo[];
		} & McpCacheableResult;
		if (typeof result.ttlMs === 'number' && result.ttlMs > 0) {
			this.#toolsCache = {
				tools: result.tools,
				expiresAt: Date.now() + result.ttlMs,
			};
		}
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
		this.#clear_pending();
	}

	async #connect_stdio(): Promise<void> {
		const {
			name,
			command,
			args = [],
			env,
		} = this.#config as McpStdioServerConfig;

		this.#proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_child_process_env(env),
		});

		this.#proc.on('error', (error) => {
			this.#close_stdio(
				new Error(
					`MCP server ${name} failed to start: ${error.message}`,
				),
			);
		});
		this.#proc.on('exit', (code, signal) => {
			this.#close_stdio(
				new Error(
					`MCP server ${name} exited before responding (${code ?? signal ?? 'unknown'})`,
				),
			);
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

	#request(
		method: string,
		params: unknown,
		protocol_version = this.#protocolEra === 'modern'
			? this.#protocolVersion
			: undefined,
	): Promise<unknown> {
		if (this.#closedError) return Promise.reject(this.#closedError);

		return new Promise((resolve, reject) => {
			const id = this.#nextId++;
			const timer = setTimeout(() => {
				if (this.#pending.has(id)) {
					this.#pending.delete(id);
					reject(new Error(`MCP request ${method} timed out`));
				}
			}, this.#config.request_timeout_ms ?? 30_000);
			timer.unref?.();
			this.#pending.set(id, { resolve, reject, timer });
			const request_params = protocol_version
				? this.#with_modern_metadata(params, protocol_version)
				: params;
			this.#send({
				jsonrpc: '2.0',
				id,
				method,
				params: request_params,
			}).catch((error) => {
				const pending = this.#pending.get(id);
				if (pending) {
					this.#pending.delete(id);
					clearTimeout(pending.timer);
					reject(error as Error);
				}
			});
		});
	}

	#close_stdio(error: Error): void {
		if (this.#closedError) return;
		this.#closedError = error;
		this.#clear_pending(error);
	}

	#clear_pending(error?: Error): void {
		for (const [id, pending] of this.#pending) {
			this.#pending.delete(id);
			clearTimeout(pending.timer);
			if (error) pending.reject(error);
		}
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
		const protocol_version = this.#get_request_protocol_version(msg);
		if (protocol_version) {
			headers.set('mcp-protocol-version', protocol_version);
			headers.set('mcp-method', msg.method);
			const method_name = this.#get_request_name(msg);
			if (method_name) headers.set('mcp-name', method_name);
		} else if (this.#sessionId) {
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
			if (body) {
				try {
					this.#dispatch_message(JSON.parse(body));
					return;
				} catch {
					// Fall through to the transport error when the body is not JSON-RPC.
				}
			}
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
		clearTimeout(pending.timer);
		if (msg.error) {
			pending.reject(
				new McpProtocolError(
					msg.error.code,
					msg.error.message,
					msg.error.data,
				),
			);
			return;
		}
		pending.resolve(msg.result);
	}

	#with_modern_metadata(
		params: unknown,
		protocol_version: string,
	): unknown {
		const base =
			params && typeof params === 'object' && !Array.isArray(params)
				? (params as Record<string, unknown>)
				: {};
		return {
			...base,
			_meta: {
				...(base._meta &&
				typeof base._meta === 'object' &&
				!Array.isArray(base._meta)
					? (base._meta as Record<string, unknown>)
					: {}),
				'io.modelcontextprotocol/protocolVersion': protocol_version,
				'io.modelcontextprotocol/clientCapabilities': {},
				'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
			},
		};
	}

	#get_request_protocol_version(
		msg: JsonRpcRequest,
	): string | undefined {
		if (!msg.params || typeof msg.params !== 'object')
			return undefined;
		const meta = (msg.params as { _meta?: unknown })._meta;
		if (!meta || typeof meta !== 'object') return undefined;
		const version = (meta as Record<string, unknown>)[
			'io.modelcontextprotocol/protocolVersion'
		];
		return typeof version === 'string' ? version : undefined;
	}

	#get_request_name(msg: JsonRpcRequest): string | undefined {
		if (!msg.params || typeof msg.params !== 'object')
			return undefined;
		const name = (msg.params as { name?: unknown }).name;
		return typeof name === 'string' ? name : undefined;
	}

	#is_modern_protocol_error(error: unknown): boolean {
		return (
			error instanceof McpProtocolError &&
			error.code <= -32020 &&
			error.code >= -32099
		);
	}

	#is_unsupported_protocol_error(
		error: unknown,
	): error is McpProtocolError {
		return (
			error instanceof McpProtocolError &&
			error.code === UNSUPPORTED_PROTOCOL_VERSION_ERROR
		);
	}

	#get_supported_versions(error: McpProtocolError): string[] {
		const supported =
			error.data && typeof error.data === 'object'
				? (error.data as { supported?: unknown }).supported
				: undefined;
		return Array.isArray(supported)
			? supported.filter(
					(version): version is string => typeof version === 'string',
				)
			: [];
	}
}
