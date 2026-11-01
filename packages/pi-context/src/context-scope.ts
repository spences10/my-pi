import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { ContextScopeOptions } from './store.js';

export function is_text_content(
	item: unknown,
): item is { type: 'text'; text: string } {
	return (
		!!item &&
		typeof item === 'object' &&
		(item as { type?: unknown }).type === 'text' &&
		typeof (item as { text?: unknown }).text === 'string'
	);
}

export function summarize_tool_input(input: unknown): string | null {
	if (!input || typeof input !== 'object') return null;
	try {
		const json = JSON.stringify(input);
		return json.length > 500 ? `${json.slice(0, 497)}...` : json;
	} catch {
		return null;
	}
}

export function should_skip_tool(tool_name: string): boolean {
	// Coverage policy:
	// - context_* tools are retrieval/maintenance output; indexing them would
	//   recurse and make the sidecar harder to reason about.
	// - Team Mode lists are bounded at source, while unusually large full-detail
	//   results use this generic overflow path so they do not flood model context.
	// - Pi native MCP tool results use this generic overflow path like other
	//   tools. Text that already holds a [context-sidecar] receipt is not
	//   indexed again.
	return tool_name.startsWith('context_');
}

export function session_id_from_context(
	ctx?: Pick<ExtensionCommandContext, 'sessionManager'>,
): string | null {
	const manager = ctx?.sessionManager;
	return (
		manager?.getSessionFile?.() ?? manager?.getSessionId?.() ?? null
	);
}

export function scope_from_context(
	ctx?: Pick<ExtensionCommandContext, 'cwd' | 'sessionManager'>,
): ContextScopeOptions {
	return {
		project_path: ctx?.cwd ?? process.cwd(),
		session_id: session_id_from_context(ctx),
	};
}
