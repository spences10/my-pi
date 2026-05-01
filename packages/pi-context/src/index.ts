import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import {
	get_context_store,
	is_context_sidecar_enabled,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
	type ContextSearchResult,
	type ContextStats,
} from './store.js';

function is_text_content(
	item: unknown,
): item is { type: 'text'; text: string } {
	return (
		!!item &&
		typeof item === 'object' &&
		(item as { type?: unknown }).type === 'text' &&
		typeof (item as { text?: unknown }).text === 'string'
	);
}

function summarize_tool_input(input: unknown): string | null {
	if (!input || typeof input !== 'object') return null;
	try {
		const json = JSON.stringify(input);
		return json.length > 500 ? `${json.slice(0, 497)}...` : json;
	} catch {
		return null;
	}
}

function should_skip_tool(tool_name: string): boolean {
	return (
		tool_name === 'context_search' ||
		tool_name === 'context_get' ||
		tool_name === 'context_stats' ||
		tool_name === 'context_purge' ||
		tool_name === 'team'
	);
}

function format_search_results(
	results: ContextSearchResult[],
): string {
	if (results.length === 0) return 'No indexed context matched.';
	return results
		.map((result, index) =>
			[
				`## ${index + 1}. ${result.title ?? result.chunk_id}`,
				`Source: ${result.source_id} • Chunk: ${result.chunk_id} • Tool: ${result.tool_name}`,
				'',
				result.content,
			].join('\n'),
		)
		.join('\n\n---\n\n');
}

function format_stats(stats: ContextStats): string {
	return [
		'## context-sidecar stats',
		'',
		`- Enabled: ${is_context_sidecar_enabled()}`,
		`- Sources: ${stats.sources}`,
		`- Chunks: ${stats.chunks}`,
		`- Raw bytes stored: ${stats.bytes_stored}`,
		`- Bytes returned: ${stats.bytes_returned}`,
		`- Bytes saved: ${stats.bytes_saved}`,
		`- Reduction: ${stats.reduction_pct}%`,
		`- DB bytes: ${stats.total_bytes}`,
	].join('\n');
}

export default function context_sidecar(pi: ExtensionAPI): void {
	set_context_sidecar_enabled(true, { project_path: process.cwd() });

	pi.on('session_start', async (_event, ctx) => {
		set_context_sidecar_enabled(true, {
			project_path: ctx.cwd,
			session_id: undefined,
		});
	});

	pi.on('session_shutdown', async () => {
		set_context_sidecar_enabled(false);
	});

	pi.on('tool_result', async (event) => {
		const tool_name = String(event.toolName ?? 'tool');
		if (should_skip_tool(tool_name)) return;
		if (!Array.isArray(event.content)) return;

		const text_items = event.content.filter(is_text_content);
		if (text_items.length === 0) return;
		const text = text_items.map((item) => item.text).join('\n');
		if (text.includes('[context-sidecar]')) return;
		if (!should_index_text(text)) return;

		try {
			const stored = maybe_store_context_output({
				text,
				tool_name,
				input_summary: summarize_tool_input(event.input),
			});
			if (!stored) return;
			return {
				content: [{ type: 'text' as const, text: stored.receipt }],
			};
		} catch {
			return;
		}
	});

	pi.registerTool({
		name: 'context_search',
		label: 'Context Search',
		description:
			'Search large tool output stored in the local SQLite context sidecar.',
		promptSnippet:
			'Search oversized tool output that was indexed into the local context sidecar',
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
		}),
		async execute(_toolCallId, params) {
			const results = get_context_store().search(params.query, {
				source_id: params.source_id,
				tool_name: params.tool_name,
				limit: params.limit,
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

	pi.registerTool({
		name: 'context_get',
		label: 'Context Get',
		description:
			'Retrieve exact chunks from the local SQLite context sidecar.',
		promptSnippet: 'Retrieve exact stored output chunks by source id',
		parameters: Type.Object({
			source_id: Type.String({ description: 'Indexed source id' }),
			chunk_id: Type.Optional(
				Type.String({ description: 'Optional exact chunk id' }),
			),
		}),
		async execute(_toolCallId, params) {
			const chunks = get_context_store().get(
				params.source_id,
				params.chunk_id,
			);
			const text = chunks.length
				? chunks
						.map((chunk) =>
							[
								`## ${chunk.id}`,
								`Source: ${chunk.source_id} • Chunk ${chunk.ordinal}`,
								'',
								chunk.content,
							].join('\n'),
						)
						.join('\n\n---\n\n')
				: 'No chunks found.';
			return {
				content: [{ type: 'text' as const, text }],
				details: { count: chunks.length },
			};
		},
	});

	pi.registerTool({
		name: 'context_stats',
		label: 'Context Stats',
		description:
			'Show byte accounting for the local SQLite context sidecar.',
		parameters: Type.Object({}),
		async execute() {
			const stats = get_context_store().stats();
			return {
				content: [
					{ type: 'text' as const, text: format_stats(stats) },
				],
				details: stats,
			};
		},
	});

	pi.registerTool({
		name: 'context_purge',
		label: 'Context Purge',
		description:
			'Delete indexed context-sidecar output by age or source id.',
		parameters: Type.Object({
			older_than_days: Type.Optional(
				Type.Number({
					description:
						'Delete sources older than this many days; default 14',
				}),
			),
			source_id: Type.Optional(
				Type.String({ description: 'Delete one source id' }),
			),
		}),
		async execute(_toolCallId, params) {
			const deleted = get_context_store().purge({
				older_than_days: params.older_than_days,
				source_id: params.source_id,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: `Deleted ${deleted} context source(s).`,
					},
				],
				details: { deleted },
			};
		},
	});

	pi.registerCommand('context-stats', {
		description: 'Show context sidecar byte accounting',
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				format_stats(get_context_store().stats()),
				'info',
			);
		},
	});
}

export {
	get_context_store,
	is_context_sidecar_enabled,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';
export type {
	ContextSearchResult,
	ContextStats,
	StoreContextInput,
	StoredContextOutput,
} from './store.js';
