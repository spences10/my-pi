import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import {
	show_confirm_modal,
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { Type } from 'typebox';
import {
	get_context_store,
	is_context_sidecar_enabled,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
	type ContextListResult,
	type ContextScopeOptions,
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
		tool_name === 'context_list' ||
		tool_name === 'context_stats' ||
		tool_name === 'context_purge' ||
		tool_name === 'team'
	);
}

function session_id_from_context(
	ctx?: Pick<ExtensionCommandContext, 'sessionManager'>,
): string | null {
	const manager = ctx?.sessionManager;
	return (
		manager?.getSessionFile?.() ?? manager?.getSessionId?.() ?? null
	);
}

function scope_from_context(
	ctx?: Pick<ExtensionCommandContext, 'cwd' | 'sessionManager'>,
): ContextScopeOptions {
	return {
		project_path: ctx?.cwd ?? process.cwd(),
		session_id: session_id_from_context(ctx),
	};
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

function format_list_results(results: ContextListResult[]): string {
	if (results.length === 0)
		return 'No indexed context sources found.';
	return results
		.map((result) =>
			[
				`## ${result.source_id}`,
				`Created: ${new Date(result.created_at).toISOString()} • Tool: ${result.tool_name}`,
				`Size: ${result.bytes} bytes, ${result.lines} lines, ${result.chunk_count} chunks`,
				`Project: ${result.project_path ?? '(none)'}`,
				`Session: ${result.session_id ?? '(none)'}`,
				result.input_summary
					? `Input: ${result.input_summary}`
					: undefined,
				result.first_chunk_title
					? `First chunk: ${result.first_chunk_title}`
					: undefined,
				result.preview ? `Preview: ${result.preview}` : undefined,
			]
				.filter(Boolean)
				.join('\n'),
		)
		.join('\n\n');
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

async function show_context_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_text_modal(ctx, {
		title,
		text,
		max_visible_lines: 18,
		overlay_options: { width: '80%', minWidth: 64 },
	});
}

async function show_context_stats(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const text = format_stats(get_context_store().stats());
	if (ctx.hasUI) {
		await show_context_text_modal(ctx, 'Context sidecar stats', text);
	} else {
		ctx.ui.notify(text, 'info');
	}
}

async function show_context_list(
	ctx: ExtensionCommandContext,
	limit?: number,
): Promise<void> {
	const scope = scope_from_context(ctx);
	const text = format_list_results(
		get_context_store(scope).list({ ...scope, limit }),
	);
	if (ctx.hasUI) {
		await show_context_text_modal(
			ctx,
			'Context sidecar sources',
			text,
		);
	} else {
		ctx.ui.notify(text, 'info');
	}
}

async function purge_context(
	ctx: ExtensionCommandContext,
	options: { older_than_days?: number; source_id?: string } = {},
): Promise<void> {
	const description = options.source_id
		? `Delete context source ${options.source_id}?`
		: `Delete context sources older than ${options.older_than_days ?? 14} day(s)?`;
	const confirmed = ctx.hasUI
		? await show_confirm_modal(ctx, {
				title: 'Purge context sidecar?',
				message: description,
				confirm_label: 'Purge',
			})
		: await ctx.ui.confirm('Purge context sidecar?', description);
	if (!confirmed) return;
	const deleted = get_context_store().purge(options);
	ctx.ui.notify(`Deleted ${deleted} context source(s).`, 'info');
}

export default function context_sidecar(pi: ExtensionAPI): void {
	set_context_sidecar_enabled(true, { project_path: process.cwd() });

	pi.on('session_start', async (_event, ctx) => {
		set_context_sidecar_enabled(true, scope_from_context(ctx));
	});

	pi.on('session_shutdown', async () => {
		set_context_sidecar_enabled(false);
	});

	pi.on('tool_result', async (event, ctx) => {
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
				...scope_from_context(ctx),
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
				...scope,
				global: params.global,
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
			global: Type.Optional(
				Type.Boolean({
					description:
						'Retrieve across all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const chunks = get_context_store(scope).get(
				params.source_id,
				params.chunk_id,
				{ ...scope, global: params.global },
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
		name: 'context_list',
		label: 'Context List',
		description:
			'List indexed sources in the local SQLite context sidecar.',
		promptSnippet:
			'List recent indexed context-sidecar sources without knowing a source id',
		parameters: Type.Object({
			source_id: Type.Optional(
				Type.String({ description: 'Limit to one source id' }),
			),
			tool_name: Type.Optional(
				Type.String({ description: 'Limit to one tool name' }),
			),
			project_path: Type.Optional(
				Type.String({ description: 'Limit to one project path' }),
			),
			session_id: Type.Optional(
				Type.String({ description: 'Limit to one session id' }),
			),
			newer_than_days: Type.Optional(
				Type.Number({
					description: 'Only sources newer than N days',
				}),
			),
			older_than_days: Type.Optional(
				Type.Number({
					description: 'Only sources older than N days',
				}),
			),
			limit: Type.Optional(
				Type.Number({ description: 'Maximum sources, default 10' }),
			),
			offset: Type.Optional(
				Type.Number({ description: 'Pagination offset, default 0' }),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'List all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const project_path = params.project_path ?? scope.project_path;
			const session_id =
				params.session_id ??
				(params.project_path ? null : scope.session_id);
			const results = get_context_store(scope).list({
				project_path,
				session_id,
				global: params.global,
				source_id: params.source_id,
				tool_name: params.tool_name,
				newer_than_days: params.newer_than_days,
				older_than_days: params.older_than_days,
				limit: params.limit,
				offset: params.offset,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_list_results(results),
					},
				],
				details: { count: results.length },
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

	pi.registerCommand('context', {
		description: 'Inspect and manage the context sidecar',
		getArgumentCompletions: (prefix) =>
			['list', 'stats', 'purge']
				.filter((item) => item.startsWith(prefix.trim()))
				.map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const [sub = '', ...rest] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			if (!sub && ctx.hasUI) {
				const selected = await show_picker_modal(ctx, {
					title: 'Context sidecar',
					subtitle: 'Local SQLite storage for oversized tool output',
					items: [
						{
							value: 'list',
							label: 'List recent sources',
							description: 'Browse indexed output in this scope',
						},
						{
							value: 'stats',
							label: 'Show stats',
							description: 'Byte accounting and storage reduction',
						},
						{
							value: 'purge',
							label: 'Purge old context',
							description: 'Delete sources older than 14 days',
						},
					],
				});
				if (!selected) return;
				if (selected === 'list') await show_context_list(ctx);
				else if (selected === 'stats') await show_context_stats(ctx);
				else await purge_context(ctx);
				return;
			}

			switch (sub || 'list') {
				case 'list': {
					const [limit_text] = rest;
					const limit = limit_text ? Number(limit_text) : undefined;
					if (limit !== undefined && !Number.isFinite(limit)) {
						ctx.ui.notify('Usage: /context list [limit]', 'warning');
						return;
					}
					await show_context_list(ctx, limit);
					return;
				}
				case 'stats':
					await show_context_stats(ctx);
					return;
				case 'purge': {
					const [kind, value] = rest;
					if (kind === 'source' && value) {
						await purge_context(ctx, { source_id: value });
						return;
					}
					const days = kind ? Number(kind) : undefined;
					if (days !== undefined && !Number.isFinite(days)) {
						ctx.ui.notify(
							'Usage: /context purge [older-than-days] or /context purge source <source-id>',
							'warning',
						);
						return;
					}
					await purge_context(ctx, { older_than_days: days });
					return;
				}
				default:
					ctx.ui.notify(
						`Unknown context command: ${sub}. Use list, stats, or purge.`,
						'warning',
					);
			}
		},
	});

	pi.registerCommand('context-stats', {
		description: 'Show context sidecar byte accounting',
		handler: async (_args, ctx) => {
			await show_context_stats(ctx);
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
	ContextListResult,
	ContextScopeOptions,
	ContextSearchResult,
	ContextStats,
	StoreContextInput,
	StoredContextOutput,
} from './store.js';
