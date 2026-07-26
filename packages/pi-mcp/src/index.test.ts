import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mcp, { should_wait_for_mcp_connections } from './index.js';

const dirs: string[] = [];
const original_home = process.env.HOME;
const original_project_config = process.env.MY_PI_MCP_PROJECT_CONFIG;
const original_idle_timeout = process.env.MY_PI_MCP_IDLE_TIMEOUT_MS;
const original_runtime_mode = process.env.MY_PI_RUNTIME_MODE;

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (original_home === undefined) delete process.env.HOME;
	else process.env.HOME = original_home;
	if (original_project_config === undefined) {
		delete process.env.MY_PI_MCP_PROJECT_CONFIG;
	} else {
		process.env.MY_PI_MCP_PROJECT_CONFIG = original_project_config;
	}
	if (original_idle_timeout === undefined) {
		delete process.env.MY_PI_MCP_IDLE_TIMEOUT_MS;
	} else {
		process.env.MY_PI_MCP_IDLE_TIMEOUT_MS = original_idle_timeout;
	}
	if (original_runtime_mode === undefined) {
		delete process.env.MY_PI_RUNTIME_MODE;
	} else {
		process.env.MY_PI_RUNTIME_MODE = original_runtime_mode;
	}
	vi.restoreAllMocks();
});

function tmp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-mcp-index-'));
	dirs.push(dir);
	return dir;
}

function create_test_pi() {
	const commands = new Map<string, { handler: Function }>();
	const events = new Map<string, Function>();
	const tools = new Map<
		string,
		{
			name: string;
			execute: Function;
			constrainedSampling?: unknown;
		}
	>();
	const pi = {
		on: vi.fn((name: string, handler: Function) => {
			events.set(name, handler);
		}),
		registerTool: vi.fn(
			(tool: Parameters<ExtensionAPI['registerTool']>[0]) => {
				tools.set(tool.name, tool);
			},
		),
		registerCommand: vi.fn(
			(
				name: string,
				command: Parameters<ExtensionAPI['registerCommand']>[1],
			) => {
				commands.set(name, command);
			},
		),
		getActiveTools: vi.fn(() => []),
		setActiveTools: vi.fn(),
	};
	return {
		pi: pi as unknown as ExtensionAPI,
		commands,
		events,
		tools,
		set_active_tools: pi.setActiveTools,
	};
}

function read_json(req: IncomingMessage): Promise<{
	id?: number | string;
	method?: string;
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

async function create_http_mcp_server(
	input_schema: Record<string, unknown> = {
		type: 'object',
		properties: {},
	},
) {
	let delete_count = 0;
	let initialize_count = 0;
	const server = createServer(async (req, res) => {
		if (req.method === 'DELETE') {
			delete_count += 1;
			res.statusCode = 204;
			res.end();
			return;
		}
		const message = await read_json(req);
		res.setHeader('content-type', 'application/json');
		res.setHeader('mcp-session-id', 'session-123');
		if (message.method === 'initialize') {
			initialize_count += 1;
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id: message.id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: {},
						serverInfo: { name: 'test', version: '1.0.0' },
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
								inputSchema: input_schema,
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
					result: { content: [{ type: 'text', text: 'pong' }] },
				}),
			);
			return;
		}
		res.statusCode = 400;
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('bad address');
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		get_delete_count: () => delete_count,
		get_initialize_count: () => initialize_count,
		close: () =>
			new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function write_mcp_config(
	dir: string,
	server_name: string,
	command: string,
) {
	writeFileSync(
		join(dir, 'mcp.json'),
		JSON.stringify({
			mcpServers: {
				[server_name]: { command },
			},
		}),
	);
}

async function run_mcp_list(cwd: string): Promise<string> {
	const { pi, commands } = create_test_pi();
	const notify = vi.fn();
	await mcp(pi);
	await commands.get('mcp')!.handler('list', {
		cwd,
		has_ui: false,
		ui: { notify },
	});
	return notify.mock.calls.map((call) => call[0]).join('\n');
}

describe('should_wait_for_mcp_connections', () => {
	it('skips blocking when selected tools are unavailable', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {},
			} as Parameters<typeof should_wait_for_mcp_connections>[0]),
		).toBe(false);
	});

	it('waits when an MCP tool is selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__demo__ping'],
				},
			} as Parameters<typeof should_wait_for_mcp_connections>[0]),
		).toBe(true);
	});

	it('skips blocking when no MCP tools are selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as Parameters<typeof should_wait_for_mcp_connections>[0]),
		).toBe(false);
	});
});

describe('MCP server lifecycle', () => {
	it('connects enabled servers before the first agent turn', async () => {
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';
		process.env.MY_PI_RUNTIME_MODE = 'interactive';
		const cwd = tmp_dir();
		const server = await create_http_mcp_server();
		try {
			writeFileSync(
				join(cwd, 'mcp.json'),
				JSON.stringify({
					mcpServers: {
						demo: { transport: 'http', url: server.url },
					},
				}),
			);

			const { pi, events, tools, set_active_tools } =
				create_test_pi();
			await mcp(pi);
			await events.get('before_agent_start')!(
				{ systemPromptOptions: { selectedTools: ['read', 'bash'] } },
				{ cwd, hasUI: false, ui: { setStatus: vi.fn() } },
			);

			expect(server.get_initialize_count()).toBe(1);
			expect(tools.has('mcp__demo__ping')).toBe(true);
			expect(
				tools.get('mcp__demo__ping')!.constrainedSampling,
			).toEqual({ type: 'json_schema', strict: 'prefer' });
			expect(set_active_tools).toHaveBeenCalledWith([
				'mcp__demo__ping',
			]);
		} finally {
			await server.close();
		}
	});

	it('keeps incompatible MCP schemas on normal tool calling', async () => {
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';
		process.env.MY_PI_RUNTIME_MODE = 'interactive';
		const cwd = tmp_dir();
		const server = await create_http_mcp_server({
			type: 'object',
			properties: { query: { type: 'string' } },
		});
		try {
			writeFileSync(
				join(cwd, 'mcp.json'),
				JSON.stringify({
					mcpServers: {
						demo: { transport: 'http', url: server.url },
					},
				}),
			);
			const { pi, events, tools } = create_test_pi();
			await mcp(pi);
			await events.get('before_agent_start')!(
				{ systemPromptOptions: { selectedTools: ['read'] } },
				{ cwd, hasUI: false, ui: { setStatus: vi.fn() } },
			);

			expect(
				tools.get('mcp__demo__ping')!.constrainedSampling,
			).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it('disconnects a connected server when disabled', async () => {
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';
		const cwd = tmp_dir();
		const server = await create_http_mcp_server();
		try {
			writeFileSync(
				join(cwd, 'mcp.json'),
				JSON.stringify({
					mcpServers: {
						demo: { transport: 'http', url: server.url },
					},
				}),
			);

			const { pi, commands, events } = create_test_pi();
			await mcp(pi);
			await events.get('session_start')!(
				{},
				{ cwd, hasUI: false, ui: {} },
			);
			expect(server.get_initialize_count()).toBe(0);
			await commands.get('mcp')!.handler('connect demo', {
				cwd,
				hasUI: false,
				ui: { notify: vi.fn(), setStatus: vi.fn() },
			});

			await commands.get('mcp')!.handler('disable demo', {
				cwd,
				hasUI: false,
				ui: { notify: vi.fn(), setStatus: vi.fn() },
			});
			await vi.waitFor(() =>
				expect(server.get_delete_count()).toBe(1),
			);
		} finally {
			await server.close();
		}
	});

	it('disconnects idle servers and reconnects on the next tool call', async () => {
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';
		process.env.MY_PI_MCP_IDLE_TIMEOUT_MS = '10';
		const cwd = tmp_dir();
		const server = await create_http_mcp_server();
		try {
			writeFileSync(
				join(cwd, 'mcp.json'),
				JSON.stringify({
					mcpServers: {
						demo: { transport: 'http', url: server.url },
					},
				}),
			);

			const { pi, commands, events, tools } = create_test_pi();
			await mcp(pi);
			await events.get('session_start')!(
				{},
				{ cwd, hasUI: false, ui: {} },
			);
			expect(server.get_initialize_count()).toBe(0);
			await commands.get('mcp')!.handler('connect demo', {
				cwd,
				hasUI: false,
				ui: { notify: vi.fn(), setStatus: vi.fn() },
			});

			await vi.waitFor(() =>
				expect(server.get_delete_count()).toBe(1),
			);

			await tools.get('mcp__demo__ping')!.execute('id', {});
			await vi.waitFor(() =>
				expect(server.get_delete_count()).toBe(2),
			);
		} finally {
			await server.close();
		}
	});
});

describe('MCP project config trust decisions', () => {
	it('skips project MCP config when env policy is skip', async () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		process.env.HOME = home;
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'skip';

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		write_mcp_config(global_dir, 'shared', 'global-cmd');
		write_mcp_config(cwd, 'project', 'project-cmd');

		const message = await run_mcp_list(cwd);

		expect(message).toContain('shared');
		expect(message).not.toContain('project');
	});

	it('allows project MCP config once with untrusted metadata', async () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		process.env.HOME = home;
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';

		write_mcp_config(cwd, 'project', 'project-cmd');

		const message = await run_mcp_list(cwd);

		expect(message).toContain('project');
		expect(message).toContain('untrusted metadata suppressed');
	});
});
