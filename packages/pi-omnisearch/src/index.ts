import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@mariozechner/pi-coding-agent';

const MCP_OMNISEARCH_TOOL_PREFIX = 'mcp__mcp-omnisearch__';

const MCP_OMNISEARCH_TOOLS = new Set([
	'web_search',
	'ai_search',
	'web_extract',
]);

function is_mcp_omnisearch_tool(tool_name: string): boolean {
	if (tool_name.startsWith(MCP_OMNISEARCH_TOOL_PREFIX)) return true;

	const [, server_name, tool] = tool_name.split('__');
	if (!server_name?.includes('omnisearch') || !tool) return false;
	return MCP_OMNISEARCH_TOOLS.has(tool);
}

export function should_inject_omnisearch_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools || selected_tools.some(is_mcp_omnisearch_tool)
	);
}

export default async function omnisearch(pi: ExtensionAPI) {
	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_omnisearch_prompt(event)) return {};
			return {
				systemPrompt:
					event.systemPrompt +
					`

## Web research via mcp-omnisearch

You have access to \`mcp-omnisearch\`, a unified MCP server for web search, AI answers, and content extraction. Use it when the user asks to research, verify current information, inspect documentation, compare tools, find sources, or cite external facts.

Preferred workflow:
- Use \`mcp__mcp-omnisearch__web_search\` for discovery. Pick providers intentionally: Tavily for factual/cited search, Brave or Kagi for operators like \`site:\` and \`filetype:\`, Exa for semantic discovery.
- Use \`mcp__mcp-omnisearch__web_extract\` to read actual source content before presenting claims. Do not rely on search snippets alone.
- Use \`mcp__mcp-omnisearch__ai_search\` when a synthesized answer with sources is more useful than raw results.
- For docs or packages, prefer official docs, repos, release notes, and source files; verify before summarizing.
- Report partial failures, source conflicts, or uncertainty instead of silently guessing.

Do not rely only on stale model memory for current web facts when mcp-omnisearch is available.`,
			};
		},
	);
}
