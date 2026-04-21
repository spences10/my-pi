import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionContext,
	defineTool,
} from '@mariozechner/pi-coding-agent';
import { McpClient, type McpServerConfig } from '../mcp/client.js';
import { load_mcp_config } from '../mcp/config.js';

interface ServerState {
	config: McpServerConfig;
	client?: McpClient;
	tool_names: string[];
	enabled: boolean;
	status: 'disconnected' | 'connecting' | 'connected' | 'failed';
	error?: string;
	connect_promise?: Promise<void>;
}

function create_server_states(
	configs: McpServerConfig[],
): Map<string, ServerState> {
	return new Map(
		configs.map((config) => [
			config.name,
			{
				config,
				tool_names: [],
				enabled: true,
				status: 'disconnected' as const,
			},
		]),
	);
}

function remove_server_tools_from_active(
	pi: ExtensionAPI,
	tool_names: string[],
): void {
	const tool_set = new Set(tool_names);
	pi.setActiveTools(
		pi.getActiveTools().filter((tool) => !tool_set.has(tool)),
	);
}

function format_server_status(state: ServerState): string {
	switch (state.status) {
		case 'connected':
			return state.enabled ? 'enabled' : 'disabled';
		case 'connecting':
			return state.enabled ? 'connecting' : 'connecting, disabled';
		case 'failed':
			return state.enabled ? 'failed' : 'failed, disabled';
		default:
			return state.enabled ? 'not connected yet' : 'disabled';
	}
}

function count_pending_enabled_servers(
	servers: ReadonlyMap<string, ServerState>,
): number {
	return Array.from(servers.values()).filter(
		(state) => state.enabled && state.status !== 'connected',
	).length;
}

function update_mcp_status(
	ctx: ExtensionContext,
	servers: ReadonlyMap<string, ServerState>,
): void {
	if (servers.size === 0) {
		ctx.ui.setStatus('mcp', undefined);
		return;
	}

	const states = Array.from(servers.values());
	const enabled = states.filter((state) => state.enabled).length;
	const connected = states.filter(
		(state) => state.enabled && state.status === 'connected',
	).length;
	const connecting = states.filter(
		(state) => state.enabled && state.status === 'connecting',
	).length;
	const failed = states.filter(
		(state) => state.enabled && state.status === 'failed',
	).length;

	const fragments = [`MCP ${connected}/${enabled} connected`];
	if (connecting > 0) fragments.push(`${connecting} connecting`);
	if (failed > 0) fragments.push(`${failed} failed`);

	ctx.ui.setStatus(
		'mcp',
		ctx.ui.theme.fg('dim', fragments.join(' · ')),
	);
}

function set_connect_feedback(
	ctx: ExtensionContext,
	pending_server_count: number,
): () => void {
	const label =
		pending_server_count === 1
			? 'Connecting 1 MCP server...'
			: `Connecting ${pending_server_count} MCP servers...`;

	ctx.ui.setWorkingMessage(label);
	ctx.ui.setWorkingIndicator({
		frames: [
			ctx.ui.theme.fg('dim', '·'),
			ctx.ui.theme.fg('muted', '•'),
			ctx.ui.theme.fg('accent', '●'),
			ctx.ui.theme.fg('muted', '•'),
		],
		intervalMs: 120,
	});
	ctx.ui.setStatus('mcp', ctx.ui.theme.fg('dim', label));

	return () => {
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	};
}

export function should_wait_for_mcp_connections(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools ||
		selected_tools.some((tool) => tool.startsWith('mcp__'))
	);
}

// Default export for Pi Package / additionalExtensionPaths loading
export default async function mcp(pi: ExtensionAPI) {
	let initialized_cwd: string | null = null;
	let servers = new Map<string, ServerState>();
	const registered_tool_names = new Set<string>();

	const ensure_servers = (cwd: string): void => {
		if (initialized_cwd !== null) return;
		servers = create_server_states(load_mcp_config(cwd));
		initialized_cwd = cwd;
	};

	const connect_server = async (
		state: ServerState,
		ctx?: ExtensionContext,
	): Promise<void> => {
		if (state.status === 'connected') return;
		if (state.connect_promise) {
			await state.connect_promise;
			return;
		}

		state.connect_promise = (async () => {
			state.status = 'connecting';
			state.error = undefined;
			if (ctx) update_mcp_status(ctx, servers);

			const client = new McpClient(state.config);
			try {
				await client.connect();
				state.client = client;

				const mcp_tools = await client.listTools();
				const tool_names: string[] = [];

				for (const mcp_tool of mcp_tools) {
					const tool_name = `mcp__${state.config.name}__${mcp_tool.name}`;
					tool_names.push(tool_name);

					if (registered_tool_names.has(tool_name)) continue;
					registered_tool_names.add(tool_name);

					pi.registerTool(
						defineTool({
							name: tool_name,
							label: `${state.config.name}: ${mcp_tool.name}`,
							description: mcp_tool.description || mcp_tool.name,
							parameters: (mcp_tool.inputSchema || {
								type: 'object',
								properties: {},
							}) as Parameters<typeof defineTool>[0]['parameters'],
							execute: async (_id, params) => {
								const result = (await state.client!.callTool(
									mcp_tool.name,
									params as Record<string, unknown>,
								)) as {
									content?: Array<{
										type: string;
										text?: string;
									}>;
								};

								const text =
									result?.content
										?.map((c) => c.text || '')
										.join('\n') || JSON.stringify(result);

								return {
									content: [{ type: 'text' as const, text }],
									details: {},
								};
							},
						}),
					);
				}

				state.tool_names = tool_names;
				state.status = 'connected';
				if (!state.enabled) {
					remove_server_tools_from_active(pi, state.tool_names);
				}
			} catch (error) {
				state.status = 'failed';
				state.error =
					error instanceof Error ? error.message : String(error);
				state.client = undefined;
				await client.disconnect().catch(() => {});
				console.error(
					`MCP server failed (${state.config.name}): ${state.error}`,
				);
				throw error;
			} finally {
				state.connect_promise = undefined;
				if (ctx) update_mcp_status(ctx, servers);
			}
		})();

		await state.connect_promise;
	};

	const connect_all_servers = async (
		options: {
			include_failed?: boolean;
			ctx?: ExtensionContext;
		} = {},
	): Promise<void> => {
		await Promise.allSettled(
			Array.from(servers.values())
				.filter((state) => state.enabled)
				.filter(
					(state) =>
						options.include_failed || state.status !== 'failed',
				)
				.map((state) => connect_server(state, options.ctx)),
		);
		if (options.ctx) update_mcp_status(options.ctx, servers);
	};

	pi.on('session_start', async (_event, ctx) => {
		ensure_servers(ctx.cwd);
		update_mcp_status(ctx, servers);
		void connect_all_servers({ ctx });
	});

	pi.on('before_agent_start', async (event, ctx) => {
		ensure_servers(ctx.cwd);
		if (!should_wait_for_mcp_connections(event)) {
			void connect_all_servers({ ctx });
			return event;
		}

		const pending_server_count =
			count_pending_enabled_servers(servers);
		if (pending_server_count === 0) {
			update_mcp_status(ctx, servers);
			return event;
		}

		const restore_feedback = set_connect_feedback(
			ctx,
			pending_server_count,
		);
		try {
			await connect_all_servers({ ctx });
			return event;
		} finally {
			restore_feedback();
			update_mcp_status(ctx, servers);
		}
	});

	pi.registerCommand('mcp', {
		description: 'Manage MCP servers (list, enable, disable)',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.split(' ');
			if (parts.length <= 1) {
				return ['list', 'enable', 'disable']
					.filter((s) => s.startsWith(prefix))
					.map((s) => ({ value: s, label: s }));
			}
			if (parts[0] === 'enable' || parts[0] === 'disable') {
				const name_prefix = parts[1] || '';
				return Array.from(servers.keys())
					.filter((n) => n.startsWith(name_prefix))
					.map((n) => ({
						value: `${parts[0]} ${n}`,
						label: n,
					}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			ensure_servers(ctx.cwd);
			const [sub, ...rest] = args.trim().split(/\s+/);
			const name = rest.join(' ');

			switch (sub || 'list') {
				case 'list': {
					if (servers.size === 0) {
						ctx.ui.notify('No MCP servers configured');
						return;
					}
					const lines: string[] = [];
					for (const [sname, state] of servers.entries()) {
						lines.push(
							`${sname} (${format_server_status(state)}) — ${state.tool_names.length} tools${state.error ? ` — ${state.error}` : ''}`,
						);
					}
					update_mcp_status(ctx, servers);
					ctx.ui.notify(lines.join('\n'));
					break;
				}
				case 'enable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (server.enabled && server.status !== 'failed') {
						ctx.ui.notify(`${name} already enabled`);
						return;
					}
					server.enabled = true;
					if (server.status === 'connected') {
						const active = pi.getActiveTools();
						pi.setActiveTools([
							...new Set([...active, ...server.tool_names]),
						]);
						update_mcp_status(ctx, servers);
						ctx.ui.notify(`Enabled ${name}`);
						return;
					}
					if (server.status === 'failed') {
						server.status = 'disconnected';
						server.error = undefined;
					}
					update_mcp_status(ctx, servers);
					void connect_server(server, ctx);
					ctx.ui.notify(
						`Enabling ${name} and connecting in background`,
					);
					break;
				}
				case 'disable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (!server.enabled) {
						ctx.ui.notify(`${name} already disabled`);
						return;
					}
					server.enabled = false;
					remove_server_tools_from_active(pi, server.tool_names);
					update_mcp_status(ctx, servers);
					ctx.ui.notify(`Disabled ${name}`);
					break;
				}
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${sub}. Use list, enable, or disable.`,
						'warning',
					);
			}
		},
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		await Promise.allSettled(
			Array.from(servers.values()).map(async (server) => {
				await server.connect_promise?.catch(() => {});
				await server.client?.disconnect();
				server.client = undefined;
				if (server.status !== 'failed') {
					server.status = 'disconnected';
				}
			}),
		);
		ctx.ui.setStatus('mcp', undefined);
	});
}
