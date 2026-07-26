import type { McpServerConfig, McpToolInfo } from './client.js';

const DEFAULT_INPUT_SCHEMA = {
	type: 'object',
	properties: {},
} as const;

const STRICT_SCHEMA_TYPES = new Set([
	'object',
	'array',
	'string',
	'number',
	'integer',
	'boolean',
	'null',
]);

const STRICT_SCHEMA_KEYS = new Set([
	'type',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'description',
	'title',
	'enum',
	'const',
]);

export type McpConstrainedSamplingReason =
	| 'eligible'
	| 'root-not-object'
	| 'invalid-schema'
	| 'unsupported-keyword'
	| 'union-type'
	| 'default-value'
	| 'optional-properties';

export interface McpConstrainedSamplingDecision {
	eligible: boolean;
	reason: McpConstrainedSamplingReason;
}

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

export function evaluate_mcp_constrained_sampling(
	schema: Record<string, unknown> | undefined,
): McpConstrainedSamplingDecision {
	if (!schema || schema.type !== 'object') {
		return { eligible: false, reason: 'root-not-object' };
	}
	return evaluate_schema_node(schema, true);
}

function evaluate_schema_node(
	schema: Record<string, unknown>,
	root = false,
): McpConstrainedSamplingDecision {
	for (const key of Object.keys(schema)) {
		if (key === 'default')
			return { eligible: false, reason: 'default-value' };
		if (!STRICT_SCHEMA_KEYS.has(key))
			return { eligible: false, reason: 'unsupported-keyword' };
	}
	if (Array.isArray(schema.type))
		return { eligible: false, reason: 'union-type' };
	if (
		typeof schema.type !== 'string' ||
		!STRICT_SCHEMA_TYPES.has(schema.type)
	)
		return { eligible: false, reason: 'invalid-schema' };
	if (root && schema.type !== 'object')
		return { eligible: false, reason: 'root-not-object' };
	if (
		schema.additionalProperties !== undefined &&
		schema.additionalProperties !== false
	)
		return { eligible: false, reason: 'unsupported-keyword' };

	if (schema.type === 'object') {
		if (
			schema.properties === undefined ||
			!schema.properties ||
			typeof schema.properties !== 'object' ||
			Array.isArray(schema.properties)
		)
			return { eligible: false, reason: 'invalid-schema' };
		const properties = schema.properties as Record<string, unknown>;
		if (
			schema.required !== undefined &&
			(!Array.isArray(schema.required) ||
				schema.required.some((key) => typeof key !== 'string'))
		)
			return { eligible: false, reason: 'invalid-schema' };
		const required = new Set(
			(schema.required as string[] | undefined) ?? [],
		);
		if ([...required].some((key) => !(key in properties)))
			return { eligible: false, reason: 'invalid-schema' };
		if (Object.keys(properties).some((key) => !required.has(key)))
			return { eligible: false, reason: 'optional-properties' };
		for (const property of Object.values(properties)) {
			if (
				!property ||
				typeof property !== 'object' ||
				Array.isArray(property)
			)
				return { eligible: false, reason: 'invalid-schema' };
			const decision = evaluate_schema_node(
				property as Record<string, unknown>,
			);
			if (!decision.eligible) return decision;
		}
	}

	if (schema.type === 'array') {
		if (
			!schema.items ||
			typeof schema.items !== 'object' ||
			Array.isArray(schema.items)
		)
			return { eligible: false, reason: 'invalid-schema' };
		return evaluate_schema_node(
			schema.items as Record<string, unknown>,
		);
	}
	return { eligible: true, reason: 'eligible' };
}

export function create_mcp_tool_registration_metadata(
	config: McpServerConfig,
	tool: McpToolInfo,
): {
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	constrained_sampling: McpConstrainedSamplingDecision;
} {
	const parameters = tool.inputSchema || { ...DEFAULT_INPUT_SCHEMA };
	const constrained_sampling =
		evaluate_mcp_constrained_sampling(parameters);
	if (is_mcp_metadata_trusted(config)) {
		return {
			label: `${config.name}: ${tool.name}`,
			description: tool.description || tool.name,
			parameters,
			constrained_sampling,
		};
	}

	return {
		label: `${config.name}: ${tool.name} (untrusted metadata)`,
		description: format_untrusted_mcp_description(
			config.name,
			tool.name,
		),
		parameters: sanitize_mcp_input_schema(tool.inputSchema),
		constrained_sampling,
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
