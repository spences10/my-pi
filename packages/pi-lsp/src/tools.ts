import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import {
	find_symbol_matches,
	format_diagnostics,
	format_document_symbols,
	format_hover,
	format_locations,
	format_symbol_matches,
	format_tool_error,
	SYMBOL_KIND_NAMES,
	SYMBOL_KIND_SCHEMA,
	to_lsp_tool_error,
	type LspToolErrorDetails,
} from './format.js';
import {
	LspServerManager,
	type FileState,
} from './server-manager.js';

const DIAGNOSTICS_MANY_CONCURRENCY = 8;

function make_tool_result(text: string, details: unknown = {}) {
	return {
		content: [{ type: 'text' as const, text }],
		details,
	};
}

function make_tool_error(details: LspToolErrorDetails) {
	return make_tool_result(format_tool_error(details), {
		ok: false,
		error: details,
	});
}

async function map_with_concurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let next_index = 0;
	const worker_count = Math.min(concurrency, items.length);

	await Promise.all(
		Array.from({ length: worker_count }, async () => {
			while (true) {
				const index = next_index;
				next_index += 1;
				if (index >= items.length) return;
				results[index] = await mapper(items[index], index);
			}
		}),
	);

	return results;
}

async function with_file_state(
	manager: LspServerManager,
	file: string,
	ctx: ExtensionContext | undefined,
	run: (result: FileState) => Promise<string>,
) {
	const resolved = await manager.resolve_file_state(file, ctx);
	if (!resolved.ok) {
		return make_tool_error(resolved.error);
	}
	const { result } = resolved;
	try {
		const text = await run(result);
		return make_tool_result(text, {
			ok: true,
			language: result.state.language,
			command: result.state.command,
			workspace_root: result.state.workspace_root,
		});
	} catch (error) {
		return make_tool_error(
			to_lsp_tool_error(
				result.abs,
				result.state.language,
				result.state.workspace_root,
				result.state.command,
				result.state.install_hint,
				error,
			),
		);
	}
}

export function register_lsp_tools(
	pi: ExtensionAPI,
	manager: LspServerManager,
): void {
	pi.registerTool(
		defineTool({
			name: 'lsp_diagnostics',
			label: 'LSP: diagnostics',
			description:
				'Get language server diagnostics (errors, warnings, hints) for a file. Uses the project language server and returns empty output if the file is clean.',
			parameters: Type.Object({
				file: Type.String({
					description:
						'Path to the file to check (relative to cwd or absolute).',
				}),
				wait_ms: Type.Optional(
					Type.Number({
						description:
							'Max ms to wait for diagnostics after opening the file. Default 1500.',
					}),
				),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const diagnostics =
						await result.state.client.wait_for_diagnostics(
							result.uri,
							params.wait_ms ?? 1500,
						);
					return format_diagnostics(result.abs, diagnostics);
				}),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_diagnostics_many',
			label: 'LSP: diagnostics many',
			description:
				'Get language server diagnostics for multiple files in one call. Useful for changed-file sweeps, package-level checks, and summarization.',
			parameters: Type.Object({
				files: Type.Array(Type.String(), {
					minItems: 1,
					maxItems: 100,
					description:
						'Files to check (relative to cwd or absolute).',
				}),
				wait_ms: Type.Optional(
					Type.Number({
						description:
							'Max ms to wait for diagnostics after opening each file. Default 1500.',
					}),
				),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) => {
				const wait_ms = params.wait_ms ?? 1500;
				const lines_with_stats = await map_with_concurrency(
					params.files,
					DIAGNOSTICS_MANY_CONCURRENCY,
					async (file) => {
						const resolved = await manager.resolve_file_state(
							file,
							ctx,
						);
						if (!resolved.ok) {
							return {
								line: format_tool_error(resolved.error),
								diagnostics: 0,
								error: true,
							};
						}
						try {
							const diagnostics =
								await resolved.result.state.client.wait_for_diagnostics(
									resolved.result.uri,
									wait_ms,
								);
							return {
								line: format_diagnostics(
									resolved.result.abs,
									diagnostics,
								),
								diagnostics: diagnostics.length,
								error: false,
							};
						} catch (error) {
							return {
								line: format_tool_error(
									to_lsp_tool_error(
										resolved.result.abs,
										resolved.result.state.language,
										resolved.result.state.workspace_root,
										resolved.result.state.command,
										resolved.result.state.install_hint,
										error,
									),
								),
								diagnostics: 0,
								error: true,
							};
						}
					},
				);

				let diagnostic_count = 0;
				let clean_count = 0;
				let error_count = 0;
				const lines: string[] = [];
				for (const entry of lines_with_stats) {
					lines.push(entry.line);
					if (entry.error) {
						error_count += 1;
					} else {
						diagnostic_count += entry.diagnostics;
						if (entry.diagnostics === 0) clean_count += 1;
					}
				}

				return make_tool_result(
					[
						`Checked ${params.files.length} file(s): ${diagnostic_count} diagnostic(s), ${clean_count} clean, ${error_count} error(s)`,
						...lines,
					].join('\n\n'),
					{
						ok: error_count === 0,
						checked: params.files.length,
						diagnostic_count,
						clean_count,
						error_count,
					},
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_find_symbol',
			label: 'LSP: find symbol',
			description:
				'Find symbols in a file by name or detail text using document symbols. Supports exact matching, kind filters, and top-level-only mode.',
			parameters: Type.Object({
				file: Type.String(),
				query: Type.String({
					description:
						'Substring to match against symbol names/details.',
				}),
				max_results: Type.Optional(
					Type.Number({
						description:
							'Max number of matches to return. Default 20.',
					}),
				),
				top_level_only: Type.Optional(
					Type.Boolean({
						description:
							'Only match top-level symbols. Default false.',
					}),
				),
				exact_match: Type.Optional(
					Type.Boolean({
						description:
							'Match whole symbol names/details exactly instead of substring matching. Default false.',
					}),
				),
				kinds: Type.Optional(
					Type.Array(SYMBOL_KIND_SCHEMA, {
						minItems: 1,
						maxItems: SYMBOL_KIND_NAMES.length,
						description: 'Restrict matches to these symbol kinds.',
					}),
				),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const symbols = await result.state.client.document_symbols(
						result.uri,
					);
					return format_symbol_matches(
						result.abs,
						params.query,
						find_symbol_matches(symbols, params.query, {
							max_results: params.max_results ?? 20,
							top_level_only: params.top_level_only ?? false,
							exact_match: params.exact_match ?? false,
							kinds: new Set(params.kinds ?? []),
						}),
					);
				}),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_hover',
			label: 'LSP: hover',
			description:
				'Get hover info (types, docs) at a position in a file. Positions are zero-based.',
			parameters: Type.Object({
				file: Type.String(),
				line: Type.Number(),
				character: Type.Number(),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const hover = await result.state.client.hover(result.uri, {
						line: params.line,
						character: params.character,
					});
					return format_hover(hover);
				}),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_definition',
			label: 'LSP: go to definition',
			description:
				'Find definition locations for the symbol at a position. Positions are zero-based.',
			parameters: Type.Object({
				file: Type.String(),
				line: Type.Number(),
				character: Type.Number(),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const locations = await result.state.client.definition(
						result.uri,
						{
							line: params.line,
							character: params.character,
						},
					);
					return format_locations(locations, 'No definition found.');
				}),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_references',
			label: 'LSP: find references',
			description:
				'Find references to the symbol at a position. Positions are zero-based.',
			parameters: Type.Object({
				file: Type.String(),
				line: Type.Number(),
				character: Type.Number(),
				include_declaration: Type.Optional(Type.Boolean()),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const locations = await result.state.client.references(
						result.uri,
						{
							line: params.line,
							character: params.character,
						},
						params.include_declaration ?? true,
					);
					return format_locations(locations, 'No references found.');
				}),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_document_symbols',
			label: 'LSP: document symbols',
			description:
				'List symbols in a file (functions, classes, variables) using the language server.',
			parameters: Type.Object({
				file: Type.String(),
			}),
			execute: async (_id, params, _signal, _on_update, ctx) =>
				with_file_state(manager, params.file, ctx, async (result) => {
					const symbols = await result.state.client.document_symbols(
						result.uri,
					);
					return format_document_symbols(result.abs, symbols);
				}),
		}),
	);
}
