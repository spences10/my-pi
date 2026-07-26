import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { format_get_result } from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import { get_context_store } from '../store.js';

export function register_context_get_tool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'context_get',
		label: 'Context Get',
		description:
			'Retrieve focused chunks from the local SQLite context sidecar. Normally pass source_id plus chunk_id and use before/after neighbors; omitting chunk_id retrieves the full source into chat.',
		promptSnippet:
			'Retrieve focused stored output chunks by source_id plus chunk_id; use before/after neighbors, avoid full-source chat retrieval',
		parameters: Type.Object({
			source_id: Type.String({ description: 'Indexed source id' }),
			chunk_id: Type.Optional(
				Type.String({
					description:
						'Exact chunk id or ordinal. Recommended for normal focused retrieval; omit only for exceptional full-source chat retrieval.',
				}),
			),
			before: Type.Optional(
				Type.Number({
					description:
						'When chunk_id is set, include up to this many chunks before it (max 3). Prefer 1 first; use context_export for broad ranges.',
				}),
			),
			after: Type.Optional(
				Type.Number({
					description:
						'When chunk_id is set, include up to this many chunks after it (max 3). Prefer 1 first; use context_export for broad ranges.',
				}),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Retrieve across all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const store = get_context_store(scope);
			const scope_options = {
				...(params.global ? {} : scope),
				global: params.global,
				before: params.before,
				after: params.after,
			};
			const chunks = store.get(
				params.source_id,
				params.chunk_id,
				scope_options,
			);
			const summary =
				chunks.length === 0
					? store.chunk_summary(params.source_id, scope_options)
					: null;
			const text = format_get_result(
				params.source_id,
				params.chunk_id,
				chunks,
				summary,
			);
			return {
				content: [{ type: 'text' as const, text }],
				details: { count: chunks.length },
			};
		},
	});
}
