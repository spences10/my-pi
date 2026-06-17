import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import {
	format_get_result,
	format_list_results,
	format_purge_details,
	format_search_results,
	format_stats,
} from './context-format.js';
import {
	is_text_content,
	scope_from_context,
	should_skip_tool,
	summarize_tool_input,
} from './context-scope.js';
import {
	cleanup_context_exports,
	resolve_context_export_path,
	write_context_export_file,
} from './export-files.js';
import {
	get_context_store,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';
import {
	purge_context,
	show_context_list,
	show_context_menu,
} from './ui/menu.js';
import {
	handle_context_settings,
	show_context_stats,
} from './ui/settings.js';

export default function context_sidecar(pi: ExtensionAPI): void {
	set_context_sidecar_enabled(true, { project_path: process.cwd() });

	pi.on('session_start', async (_event, ctx) => {
		const scope = scope_from_context(ctx);
		set_context_sidecar_enabled(true, scope);
		get_context_store(scope).cleanup();
	});

	pi.on('session_shutdown', async () => {
		const store = get_context_store();
		const stats = store.stats();
		if (stats.purge_on_shutdown) store.cleanup();
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
				...(params.global ? {} : scope),
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
			const store = get_context_store(scope);
			const scope_options = {
				...(params.global ? {} : scope),
				global: params.global,
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

	pi.registerTool({
		name: 'context_export',
		label: 'Context Export',
		description:
			'Export stored chunks from the local SQLite context sidecar to a file without returning chunk content.',
		promptSnippet:
			'Write stored context-sidecar chunks to a file without loading them into model context',
		parameters: Type.Object({
			source_id: Type.String({ description: 'Indexed source id' }),
			file_path: Type.Optional(
				Type.String({
					description:
						'Destination file path. Relative paths resolve from the current working directory. Defaults to the managed context export directory.',
				}),
			),
			chunk_id: Type.Optional(
				Type.String({ description: 'Optional exact chunk id' }),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Export across all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const store = get_context_store(scope);
			const scope_options = {
				...(params.global ? {} : scope),
				global: params.global,
			};
			const exported = store.export_content(
				params.source_id,
				params.chunk_id,
				scope_options,
			);
			if (exported.chunks.length === 0) {
				const summary = store.chunk_summary(
					params.source_id,
					scope_options,
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: format_get_result(
								params.source_id,
								params.chunk_id,
								exported.chunks,
								summary,
							),
						},
					],
					details: { count: 0, exported: false },
				};
			}

			const cwd = ctx?.cwd ?? process.cwd();
			cleanup_context_exports();
			const file_path = resolve_context_export_path(
				params.file_path,
				cwd,
				params.source_id,
				params.chunk_id,
			);
			write_context_export_file(file_path, exported.content);
			const verification =
				exported.verified === false
					? ' Reconstruction hash did not match the stored source; this source may have been captured by an older non-lossless chunker.'
					: '';

			return {
				content: [
					{
						type: 'text' as const,
						text: `Exported ${exported.chunks.length} chunk(s) from ${params.source_id} to ${file_path}.${verification}`,
					},
				],
				details: {
					count: exported.chunks.length,
					exported: true,
					file_path,
					bytes: Buffer.byteLength(exported.content, 'utf8'),
					verified: exported.verified,
				},
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
			const has_explicit_scope =
				params.project_path !== undefined ||
				params.session_id !== undefined;
			const project_path = has_explicit_scope
				? params.project_path
				: scope.project_path;
			const session_id = has_explicit_scope
				? params.session_id
				: scope.session_id;
			const results = get_context_store(scope).list({
				project_path,
				session_id,
				global: params.global || has_explicit_scope,
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
		parameters: Type.Object({
			global: Type.Optional(
				Type.Boolean({
					description:
						'Show stats across all indexed sources instead of current project/session scope.',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const stats = get_context_store(scope).stats(
				params.global === true ? { global: true } : scope,
			);
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
			'Delete indexed context-sidecar output by age, source, project, session, or active retention policy.',
		parameters: Type.Object({
			expired: Type.Optional(
				Type.Boolean({
					description:
						'Run active retention cleanup now instead of manual age purge',
				}),
			),
			older_than_days: Type.Optional(
				Type.Number({
					description:
						'Delete sources older than this many days; defaults to active retention days or 14',
				}),
			),
			source_id: Type.Optional(
				Type.String({ description: 'Delete one source id' }),
			),
			project_path: Type.Optional(
				Type.String({
					description: 'Limit purge to one project path',
				}),
			),
			session_id: Type.Optional(
				Type.String({ description: 'Limit purge to one session id' }),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Purge all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const store = get_context_store(scope);
			const stats = store.stats();
			const has_explicit_scope =
				params.project_path !== undefined ||
				params.session_id !== undefined;
			const project_path = params.global
				? params.project_path
				: has_explicit_scope
					? params.project_path
					: scope.project_path;
			const session_id = params.global
				? params.session_id
				: has_explicit_scope
					? params.session_id
					: scope.session_id;
			const details = params.expired
				? { deleted: store.cleanup().deleted }
				: store.purge_with_details({
						project_path,
						session_id,
						older_than_days: params.source_id
							? undefined
							: (params.older_than_days ??
								stats.retention_days ??
								14),
						source_id: params.source_id,
					});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_purge_details(details),
					},
				],
				details,
			};
		},
	});

	pi.registerCommand('context', {
		description: 'Inspect and manage the context sidecar',
		getArgumentCompletions: (prefix) =>
			['list', 'stats', 'settings', 'purge']
				.filter((item) => item.startsWith(prefix.trim()))
				.map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const [sub = '', ...rest] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			if (!sub && ctx.hasUI) {
				await show_context_menu(ctx);
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
				case 'settings':
					await handle_context_settings(ctx, rest);
					return;
				case 'purge': {
					const [kind, value] = rest;
					if (kind === 'expired') {
						await purge_context(ctx, { expired: true });
						return;
					}
					if (kind === 'source' && value) {
						await purge_context(ctx, { source_id: value });
						return;
					}
					const days = kind ? Number(kind) : undefined;
					if (days !== undefined && !Number.isFinite(days)) {
						ctx.ui.notify(
							'Usage: /context purge [older-than-days] | expired | source <source-id>',
							'warning',
						);
						return;
					}
					await purge_context(ctx, { older_than_days: days });
					return;
				}
				default:
					ctx.ui.notify(
						`Unknown context command: ${sub}. Use list, stats, settings, or purge.`,
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
	context_settings_from_preset,
	CONTEXT_SETTINGS_PRESETS,
	get_context_capture_limits,
	get_context_mcp_output_limits,
	get_context_settings_config_path,
	load_context_settings_config,
	save_context_settings_config,
} from './config.js';
export type {
	ContextOutputLimits,
	ContextSettingsConfig,
	ContextSettingsPreset,
	ContextSettingsValues,
} from './config.js';
export {
	run_context_eval,
	run_context_eval_cli,
} from './eval/index.js';
export {
	get_context_store,
	is_context_sidecar_enabled,
	maybe_store_context_output,
	parse_context_retention_policy,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';
export type {
	ContextCleanupResult,
	ContextListResult,
	ContextPurgeDetails,
	ContextRetentionPolicy,
	ContextScopeOptions,
	ContextSearchResult,
	ContextStats,
	StoreContextInput,
	StoredContextOutput,
} from './store.js';

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === process.argv[1]
) {
	const { run_context_eval_cli } = await import('./eval/index.js');
	await run_context_eval_cli();
}
