import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@mariozechner/pi-coding-agent';

const MCP_SQLITE_TOOL_PREFIX = 'mcp__mcp-sqlite-tools__';

const MCP_SQLITE_TOOL_SUFFIXES = new Set([
	'open_database',
	'create_database',
	'close_database',
	'list_databases',
	'database_info',
	'list_tables',
	'describe_table',
	'create_table',
	'drop_table',
	'backup_database',
	'vacuum_database',
	'execute_read_query',
	'execute_write_query',
	'execute_schema_query',
	'bulk_insert',
	'begin_transaction',
	'commit_transaction',
	'rollback_transaction',
	'export_schema',
	'import_schema',
]);

function is_mcp_sqlite_tool(tool_name: string): boolean {
	if (tool_name.startsWith(MCP_SQLITE_TOOL_PREFIX)) return true;

	const [, server_name, tool] = tool_name.split('__');
	if (!server_name?.includes('sqlite') || !tool) return false;
	return MCP_SQLITE_TOOL_SUFFIXES.has(tool);
}

export function should_inject_sqlite_tools_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.some(is_mcp_sqlite_tool);
}

export default async function sqlite_tools(pi: ExtensionAPI) {
	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_sqlite_tools_prompt(event)) return {};
			return {
				systemPrompt:
					event.systemPrompt +
					`

## SQLite database access via mcp-sqlite-tools

You have access to \`mcp-sqlite-tools\`, a gated MCP server for SQLite database work. Prefer it over raw \`sqlite3\`, Python SQLite scripts, or ad-hoc SQL through \`bash\` when inspecting or modifying SQLite files.

Use it when:
- The user asks to inspect, query, analyze, or modify \`.db\`, \`.sqlite\`, or \`.sqlite3\` files
- You need schema, tables, row counts, PRAGMAs, telemetry, analytics, or session data stored in SQLite
- You are tempted to run \`sqlite3 ...\` or write a one-off script solely to execute SQL

Preferred workflow:
- Open existing databases with \`mcp__mcp-sqlite-tools__open_database\`; use \`create_database\` only when explicitly creating a new database
- Discover structure with \`database_info\`, \`list_tables\`, \`describe_table\`, and \`export_schema\` before writing queries
- Use \`execute_read_query\` for \`SELECT\`, \`PRAGMA\`, and \`EXPLAIN\`; keep result limits small unless the user asks otherwise
- Before writes or schema changes, prefer \`backup_database\` and explicit transactions; use \`execute_write_query\` or \`execute_schema_query\` only when the intent is clear
- Close databases with \`close_database\` when finished

Use raw \`sqlite3\` or shell scripts only when MCP tools are unavailable or the user explicitly asks to bypass the MCP workflow. Do not bypass the MCP safety gates just to make destructive SQL easier.`,
			};
		},
	);
}
