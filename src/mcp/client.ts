import { spawn, type ChildProcess } from 'node:child_process';

export interface McpServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number;
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

	constructor(config: McpServerConfig) {
		this.#config = config;
	}

	async connect(): Promise<void> {
		const { command, args = [], env } = this.#config;

		this.#proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env, ...env },
		});

		this.#proc.stdout!.setEncoding('utf8');
		this.#proc.stdout!.on('data', (chunk: string) => {
			this.#buffer += chunk;
			const lines = this.#buffer.split('\n');
			this.#buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line) as JsonRpcResponse;
					if (msg.id != null && this.#pending.has(msg.id)) {
						const p = this.#pending.get(msg.id)!;
						this.#pending.delete(msg.id);
						if (msg.error) {
							p.reject(
								new Error(
									`MCP error ${msg.error.code}: ${msg.error.message}`,
								),
							);
						} else {
							p.resolve(msg.result);
						}
					}
				} catch {
					// ignore non-JSON lines
				}
			}
		});

		// Initialize handshake
		await this.#request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'my-pi', version: '0.0.1' },
		});

		// Send initialized notification (no response expected)
		this.#send({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		} as unknown as JsonRpcRequest);
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
		if (this.#proc) {
			this.#proc.kill();
			this.#proc = null;
		}
		this.#pending.clear();
	}

	#request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = this.#nextId++;
			this.#pending.set(id, { resolve, reject });
			this.#send({ jsonrpc: '2.0', id, method, params });

			setTimeout(() => {
				if (this.#pending.has(id)) {
					this.#pending.delete(id);
					reject(new Error(`MCP request ${method} timed out`));
				}
			}, 30_000);
		});
	}

	#send(msg: JsonRpcRequest) {
		if (!this.#proc?.stdin?.writable) {
			throw new Error('MCP server not connected');
		}
		this.#proc.stdin.write(JSON.stringify(msg) + '\n');
	}
}
