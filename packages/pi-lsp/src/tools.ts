import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
	find_symbol_matches,
	format_diagnostics,
	format_document_symbols,
	format_hover,
	format_locations,
	format_missing_diagnostics,
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
	signal: AbortSignal | undefined,
	run: (
		result: FileState,
	) => Promise<string | { text: string; details: object }>,
) {
	const resolved = await manager.resolve_file_state(
		file,
		ctx,
		signal,
	);
	if (!resolved.ok) {
		return make_tool_error(resolved.error);
	}
	const { result } = resolved;
	try {
		const output = await run(result);
		return make_tool_result(
			typeof output === 'string' ? output : output.text,
			{
				ok: true,
				language: result.state.language,
				command: result.state.command,
				workspace_root: result.state.workspace_root,
				...(typeof output === 'string' ? {} : output.details),
			},
		);
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
	} finally {
		await manager.release_file_state(result);
	}
}

export async function run_diagnostics_many(
	manager: LspServerManager,
	files: string[],
	wait_ms = 1500,
	ctx?: ExtensionContext,
	signal?: AbortSignal,
) {
	const lines_with_stats = await map_with_concurrency(
		files,
		DIAGNOSTICS_MANY_CONCURRENCY,
		async (file) => {
			const resolved = await manager.resolve_file_state(
				file,
				ctx,
				signal,
			);
			if (!resolved.ok) {
				return {
					line: format_tool_error(resolved.error),
					diagnostics: 0,
					status: 'error' as const,
				};
			}
			try {
				const diagnostics =
					await resolved.result.state.client.wait_for_diagnostics(
						resolved.result.uri,
						wait_ms,
					);
				if (!diagnostics) {
					return {
						line: format_missing_diagnostics(
							resolved.result.abs,
							wait_ms,
						),
						diagnostics: 0,
						status: 'incomplete' as const,
					};
				}
				return {
					line: format_diagnostics(resolved.result.abs, diagnostics),
					diagnostics: diagnostics.length,
					status: 'checked' as const,
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
					status: 'error' as const,
				};
			} finally {
				await manager.release_file_state(resolved.result);
			}
		},
	);

	let diagnostic_count = 0;
	let clean_count = 0;
	let error_count = 0;
	let incomplete_count = 0;
	const lines: string[] = [];
	for (const entry of lines_with_stats) {
		lines.push(entry.line);
		if (entry.status === 'error') {
			error_count += 1;
		} else if (entry.status === 'incomplete') {
			incomplete_count += 1;
		} else {
			diagnostic_count += entry.diagnostics;
			if (entry.diagnostics === 0) clean_count += 1;
		}
	}

	return make_tool_result(
		[
			`Checked ${files.length} file(s): ${diagnostic_count} diagnostic(s), ${clean_count} clean, ${error_count} error(s)${incomplete_count ? `, ${incomplete_count} incomplete (not validated)` : ''}`,
			...lines,
		].join('\n\n'),
		{
			ok: error_count === 0 && incomplete_count === 0,
			checked: files.length,
			diagnostic_count,
			clean_count,
			error_count,
			incomplete_count,
		},
	);
}

export function register_lsp_tools(
	pi: ExtensionAPI,
	manager: LspServerManager,
): void {
	pi.registerTool(
		defineTool({
			name: 'lsp_diagnostics',
			exposure: 'codemode',
			label: 'LSP: diagnostics',
			description:
				'Get language server diagnostics (errors, warnings, hints) for a file. Uses the project language server and reports "no diagnostics" if the file is clean. A "validation incomplete" result means the server sent nothing in time; it is not a clean result.',
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
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const wait_ms = params.wait_ms ?? 1500;
						const diagnostics =
							await result.state.client.wait_for_diagnostics(
								result.uri,
								wait_ms,
							);
						if (!diagnostics) {
							return {
								text: format_missing_diagnostics(result.abs, wait_ms),
								details: { ok: false, incomplete: true },
							};
						}
						return format_diagnostics(result.abs, diagnostics);
					},
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_diagnostics_many',
			exposure: 'codemode',
			label: 'LSP: diagnostics many',
			description:
				'Get language server diagnostics for multiple files in one call. Useful for changed-file sweeps, package-level checks, and summarization. Files counted as incomplete got no diagnostics in time and are not validated.',
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
			execute: async (_id, params, signal, _on_update, ctx) =>
				run_diagnostics_many(
					manager,
					params.files,
					params.wait_ms,
					ctx,
					signal,
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_find_symbol',
			exposure: 'codemode',
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
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const symbols =
							await result.state.client.document_symbols(result.uri);
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
					},
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_hover',
			exposure: 'codemode',
			label: 'LSP: hover',
			constrainedSampling: { type: 'json_schema', strict: 'prefer' },
			description:
				'Get hover info (types, docs) at a position in a file. Positions are zero-based.',
			parameters: Type.Object(
				{
					file: Type.String(),
					line: Type.Number(),
					character: Type.Number(),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const hover = await result.state.client.hover(
							result.uri,
							{
								line: params.line,
								character: params.character,
							},
						);
						return format_hover(hover);
					},
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_definition',
			exposure: 'codemode',
			label: 'LSP: go to definition',
			constrainedSampling: { type: 'json_schema', strict: 'prefer' },
			description:
				'Find definition locations for the symbol at a position. Positions are zero-based.',
			parameters: Type.Object(
				{
					file: Type.String(),
					line: Type.Number(),
					character: Type.Number(),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const locations = await result.state.client.definition(
							result.uri,
							{
								line: params.line,
								character: params.character,
							},
						);
						return format_locations(
							locations,
							'No definition found.',
						);
					},
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_references',
			exposure: 'codemode',
			label: 'LSP: find references',
			description:
				'Find references to the symbol at a position. Positions are zero-based.',
			parameters: Type.Object({
				file: Type.String(),
				line: Type.Number(),
				character: Type.Number(),
				include_declaration: Type.Optional(Type.Boolean()),
			}),
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const locations = await result.state.client.references(
							result.uri,
							{
								line: params.line,
								character: params.character,
							},
							params.include_declaration ?? true,
						);
						return format_locations(
							locations,
							'No references found.',
						);
					},
				),
		}),
	);

	pi.registerTool(
		defineTool({
			name: 'lsp_document_symbols',
			exposure: 'codemode',
			label: 'LSP: document symbols',
			constrainedSampling: { type: 'json_schema', strict: 'prefer' },
			description:
				'List symbols in a file (functions, classes, variables) using the language server.',
			parameters: Type.Object(
				{
					file: Type.String(),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, params, signal, _on_update, ctx) =>
				with_file_state(
					manager,
					params.file,
					ctx,
					signal,
					async (result) => {
						const symbols =
							await result.state.client.document_symbols(result.uri);
						return format_document_symbols(result.abs, symbols);
					},
				),
		}),
	);
}
