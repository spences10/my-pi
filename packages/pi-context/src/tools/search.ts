import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { format_search_results } from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import { get_context_store } from '../store.js';

export function register_context_search_tool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'context_search',
		label: 'Context Search',
		description:
			'Search large tool output stored in the local SQLite context sidecar. Use this snippet-first before retrieving chunks; reserve full_content:true for small matched chunks, not broad retrieval.',
		promptSnippet:
			'Search oversized tool output with concise snippets before retrieving chunks; export broad results for offline rg/jq/Python work',
		parameters: Type.Object({
			query: Type.String({ description: 'FTS search query' }),
			source_id: Type.Optional(
				Type.String({
					description: 'Limit to one indexed source id',
				}),
			),
			tool_name: Type.Optional(
				Type.String({ description: 'Limit to one tool name' }),
			),
			limit: Type.Optional(
				Type.Number({
					description: 'Maximum chunks to return, default 5',
				}),
			),
			full_content: Type.Optional(
				Type.Boolean({
					description:
						'Return full matched chunks instead of concise snippets. Last resort for small matches only; prefer context_get before/after or context_export for large outputs.',
				}),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Search all indexed sources instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const results = get_context_store(scope).search(params.query, {
				...(params.global ? {} : scope),
				global: params.global,
				source_id: params.source_id,
				tool_name: params.tool_name,
				limit: params.limit,
				full_content: params.full_content,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_search_results(results),
					},
				],
				details: { count: results.length },
			};
		},
	});
}
