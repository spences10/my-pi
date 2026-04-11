import { defineTool } from '@mariozechner/pi-coding-agent';
import { McpClient, type McpServerConfig } from './client.js';

export async function create_mcp_tools(configs: McpServerConfig[]) {
	const clients: McpClient[] = [];
	const tools: ReturnType<typeof defineTool>[] = [];

	for (const config of configs) {
		const client = new McpClient(config);
		await client.connect();
		clients.push(client);

		const mcp_tools = await client.listTools();

		for (const mcp_tool of mcp_tools) {
			const tool_name = `mcp__${config.name}__${mcp_tool.name}`;

			tools.push(
				defineTool({
					name: tool_name,
					label: `${config.name}: ${mcp_tool.name}`,
					description: mcp_tool.description || mcp_tool.name,
					parameters: (mcp_tool.inputSchema || {
						type: 'object',
						properties: {},
					}) as Parameters<typeof defineTool>[0]['parameters'],
					execute: async (_toolCallId, params) => {
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
	}

	return {
		tools,
		async cleanup() {
			for (const client of clients) {
				await client.disconnect();
			}
		},
	};
}
