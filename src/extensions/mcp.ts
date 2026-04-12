import {
	type ExtensionAPI,
	defineTool,
} from '@mariozechner/pi-coding-agent';
import { McpClient, type McpServerConfig } from '../mcp/client.js';
import { load_mcp_config } from '../mcp/config.js';

interface ServerState {
	config: McpServerConfig;
	client: McpClient;
	tool_names: string[];
	enabled: boolean;
}

// Default export for Pi Package / additionalExtensionPaths loading
export default async function mcp(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const servers = new Map<string, ServerState>();
	const configs = load_mcp_config(cwd);

	// Connect all MCP servers in parallel for faster startup
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const client = new McpClient(config);
			await client.connect();
			const mcp_tools = await client.listTools();
			return { config, client, mcp_tools };
		}),
	);

	for (const result of results) {
		if (result.status === 'rejected') {
			console.error(`MCP server failed: ${result.reason}`);
			continue;
		}

		const { config, client, mcp_tools } = result.value;
		const tool_names: string[] = [];

		for (const mcp_tool of mcp_tools) {
			const tool_name = `mcp__${config.name}__${mcp_tool.name}`;
			tool_names.push(tool_name);

			pi.registerTool(
				defineTool({
					name: tool_name,
					label: `${config.name}: ${mcp_tool.name}`,
					description: mcp_tool.description || mcp_tool.name,
					parameters: (mcp_tool.inputSchema || {
						type: 'object',
						properties: {},
					}) as Parameters<typeof defineTool>[0]['parameters'],
					execute: async (_id, params) => {
						const result = (await client.callTool(
							mcp_tool.name,
							params as Record<string, unknown>,
						)) as {
							content?: Array<{
								type: string;
								text?: string;
							}>;
						};

						const text =
							result?.content?.map((c) => c.text || '').join('\n') ||
							JSON.stringify(result);

						return {
							content: [{ type: 'text' as const, text }],
							details: {},
						};
					},
				}),
			);
		}

		servers.set(config.name, {
			config,
			client,
			tool_names,
			enabled: true,
		});
	}

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
						const status = state.enabled ? 'enabled' : 'disabled';
						lines.push(
							`${sname} (${status}) — ${state.tool_names.length} tools`,
						);
					}
					ctx.ui.notify(lines.join('\n'));
					break;
				}
				case 'enable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (server.enabled) {
						ctx.ui.notify(`${name} already enabled`);
						return;
					}
					server.enabled = true;
					const active = pi.getActiveTools();
					pi.setActiveTools([...active, ...server.tool_names]);
					ctx.ui.notify(`Enabled ${name}`);
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
					const tool_set = new Set(server.tool_names);
					pi.setActiveTools(
						pi.getActiveTools().filter((t) => !tool_set.has(t)),
					);
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

	pi.on('session_shutdown', async () => {
		for (const server of servers.values()) {
			await server.client.disconnect();
		}
	});
}
