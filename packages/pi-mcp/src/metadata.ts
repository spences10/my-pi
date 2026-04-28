import type { McpServerConfig, McpToolInfo } from './client.js';

const DEFAULT_INPUT_SCHEMA = {
	type: 'object',
	properties: {},
} as const;

const UNTRUSTED_SCHEMA_PROSE_KEYS = new Set([
	'$comment',
	'default',
	'description',
	'enumDescriptions',
	'errorMessage',
	'examples',
	'markdownDescription',
	'title',
]);

export function is_mcp_metadata_trusted(
	config: Pick<McpServerConfig, 'metadata_trusted'>,
): boolean {
	return config.metadata_trusted !== false;
}

export function sanitize_mcp_input_schema(
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const sanitized = sanitize_schema_value(
		schema ?? DEFAULT_INPUT_SCHEMA,
	);
	if (
		!sanitized ||
		typeof sanitized !== 'object' ||
		Array.isArray(sanitized)
	) {
		return { ...DEFAULT_INPUT_SCHEMA };
	}
	return sanitized as Record<string, unknown>;
}

export function format_untrusted_mcp_description(
	server_name: string,
	tool_name: string,
): string {
	return `Untrusted MCP tool "${tool_name}" from server "${server_name}". Rich MCP metadata suppressed until this server is trusted.`;
}

export function create_mcp_tool_registration_metadata(
	config: McpServerConfig,
	tool: McpToolInfo,
): {
	label: string;
	description: string;
	parameters: Record<string, unknown>;
} {
	if (is_mcp_metadata_trusted(config)) {
		return {
			label: `${config.name}: ${tool.name}`,
			description: tool.description || tool.name,
			parameters: tool.inputSchema || { ...DEFAULT_INPUT_SCHEMA },
		};
	}

	return {
		label: `${config.name}: ${tool.name} (untrusted metadata)`,
		description: format_untrusted_mcp_description(
			config.name,
			tool.name,
		),
		parameters: sanitize_mcp_input_schema(tool.inputSchema),
	};
}

function sanitize_schema_value(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitize_schema_value(entry));
	}
	if (!value || typeof value !== 'object') return value;

	const sanitized: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (UNTRUSTED_SCHEMA_PROSE_KEYS.has(key)) continue;
		sanitized[key] = sanitize_schema_value(entry);
	}
	return sanitized;
}
