import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import {
	file_path_to_uri,
	LspClient,
	LspClientStartError,
	type LspClientOptions,
	type LspDiagnostic,
	type LspDocumentSymbol,
	type LspHover,
	type LspLocation,
	type LspPosition,
} from '../../lsp/client.js';
import {
	detect_language,
	find_workspace_root,
	get_server_config,
	language_id_for_file,
	list_supported_languages,
} from '../../lsp/servers.js';

interface ServerState {
	client: LspClientLike;
	language: string;
	workspace_root: string;
	root_uri: string;
	command: string;
	install_hint?: string;
}

interface LspToolErrorDetails {
	kind:
		| 'unsupported_language'
		| 'server_start_failed'
		| 'tool_execution_failed';
	file: string;
	message: string;
	language?: string;
	command?: string;
	workspace_root?: string;
	install_hint?: string;
	code?: string;
}

class LspToolError extends Error {
	details: LspToolErrorDetails;

	constructor(details: LspToolErrorDetails) {
		super(details.message);
		this.name = 'LspToolError';
		this.details = details;
	}
}

class LspStartupCancelledError extends Error {
	constructor(language: string, workspace_root: string) {
		super(
			`Startup cancelled for ${language} LSP in ${workspace_root}`,
		);
		this.name = 'LspStartupCancelledError';
	}
}

interface StartingServerState {
	cancelled: boolean;
	promise: Promise<ServerState | undefined>;
}

const SYMBOL_KIND_LABELS: Record<number, string> = {
	2: 'module',
	3: 'namespace',
	5: 'class',
	6: 'method',
	7: 'property',
	8: 'field',
	9: 'constructor',
	11: 'interface',
	12: 'function',
	13: 'variable',
	14: 'constant',
	23: 'struct',
	24: 'event',
};

const SYMBOL_KIND_NAMES = Object.values(SYMBOL_KIND_LABELS);
const SYMBOL_KIND_SCHEMA = Type.Union(
	SYMBOL_KIND_NAMES.map((name) => Type.Literal(name)),
);

export interface LspClientLike {
	start(): Promise<void>;
	stop(): Promise<void>;
	is_ready(): boolean;
	ensure_document_open(uri: string, text: string): Promise<void>;
	hover(uri: string, position: LspPosition): Promise<LspHover | null>;
	definition(
		uri: string,
		position: LspPosition,
	): Promise<LspLocation[]>;
	references(
		uri: string,
		position: LspPosition,
		include_declaration: boolean,
	): Promise<LspLocation[]>;
	document_symbols(uri: string): Promise<LspDocumentSymbol[]>;
	wait_for_diagnostics(
		uri: string,
		timeout_ms?: number,
	): Promise<LspDiagnostic[]>;
}

export interface CreateLspExtensionOptions {
	create_client?: (options: LspClientOptions) => LspClientLike;
	read_file?: (path: string) => Promise<string>;
	cwd?: () => string;
}

export function create_lsp_extension(
	options: CreateLspExtensionOptions = {},
) {
	const create_client =
		options.create_client ??
		((client_options: LspClientOptions) =>
			new LspClient(client_options));
	const read_file =
		options.read_file ?? ((path: string) => readFile(path, 'utf-8'));

	return async function lsp(pi: ExtensionAPI) {
		const cwd = options.cwd?.() ?? process.cwd();
		const clients_by_server = new Map<string, ServerState>();
		const failed_servers = new Map<string, LspToolErrorDetails>();
		const starting_servers = new Map<string, StartingServerState>();

		const resolve_abs = (file: string): string =>
			isAbsolute(file) ? file : resolve(cwd, file);
		const server_key = (
			language: string,
			workspace_root: string,
		): string => `${language}\u0000${workspace_root}`;
		const make_tool_result = (
			text: string,
			details: unknown = {},
		) => ({
			content: [{ type: 'text' as const, text }],
			details,
		});
		const make_tool_error = (details: LspToolErrorDetails) =>
			make_tool_result(format_tool_error(details), {
				ok: false,
				error: details,
			});

		const clear_language_state = async (
			language?: string,
		): Promise<void> => {
			const states = language
				? Array.from(clients_by_server.entries()).filter(
						([, state]) => state.language === language,
					)
				: Array.from(clients_by_server.entries());
			const starting = language
				? Array.from(starting_servers.entries()).filter(([key]) =>
						key.startsWith(`${language}\u0000`),
					)
				: Array.from(starting_servers.entries());
			for (const [key, startup] of starting) {
				startup.cancelled = true;
				starting_servers.delete(key);
			}
			await Promise.allSettled(
				states.map(([, state]) => state.client.stop()),
			);
			for (const [key] of states) {
				clients_by_server.delete(key);
			}

			if (!language) {
				failed_servers.clear();
				return;
			}
			for (const [key, failure] of failed_servers.entries()) {
				if (failure.language === language) {
					failed_servers.delete(key);
				}
			}
		};

		const get_or_start_client = async (
			file_path: string,
		): Promise<ServerState | undefined> => {
			const language = detect_language(file_path);
			if (!language) return undefined;
			const workspace_root = find_workspace_root(file_path, cwd);
			const key = server_key(language, workspace_root);
			const existing = clients_by_server.get(key);
			if (existing) return existing;
			const failed = failed_servers.get(key);
			if (failed) {
				throw new LspToolError(failed);
			}
			const in_flight = starting_servers.get(key);
			if (in_flight) return in_flight.promise;

			const server_config = get_server_config(
				language,
				workspace_root,
			);
			if (!server_config) return undefined;
			const root_uri = file_path_to_uri(workspace_root);

			const startup: StartingServerState = {
				cancelled: false,
				promise: Promise.resolve<ServerState | undefined>(undefined),
			};
			const start_promise = (async () => {
				const client = create_client({
					command: server_config.command,
					args: server_config.args,
					root_uri,
					language_id_for_uri: (uri) => language_id_for_file(uri),
				});

				try {
					await client.start();
				} catch (error) {
					if (startup.cancelled) {
						throw new LspStartupCancelledError(
							language,
							workspace_root,
						);
					}
					const failure = to_lsp_tool_error(
						file_path,
						language,
						workspace_root,
						server_config.command,
						server_config.install_hint,
						error,
					);
					failed_servers.set(key, failure);
					throw new LspToolError(failure);
				}

				if (startup.cancelled) {
					await Promise.allSettled([client.stop()]);
					throw new LspStartupCancelledError(
						language,
						workspace_root,
					);
				}

				const state: ServerState = {
					client,
					language,
					workspace_root,
					root_uri,
					command: server_config.command,
					install_hint: server_config.install_hint,
				};
				clients_by_server.set(key, state);
				failed_servers.delete(key);
				return state;
			})();

			startup.promise = start_promise;
			starting_servers.set(key, startup);
			try {
				return await start_promise;
			} finally {
				if (starting_servers.get(key) === startup) {
					starting_servers.delete(key);
				}
			}
		};

		const open_file = async (
			state: ServerState,
			abs_path: string,
		): Promise<string> => {
			const text = await read_file(abs_path);
			const uri = file_path_to_uri(abs_path);
			await state.client.ensure_document_open(uri, text);
			return uri;
		};

		const get_file_state = async (
			file: string,
		): Promise<
			| {
					abs: string;
					uri: string;
					state: ServerState;
			  }
			| undefined
		> => {
			const abs = resolve_abs(file);
			const state = await get_or_start_client(abs);
			if (!state) return undefined;
			const uri = await open_file(state, abs);
			return { abs, uri, state };
		};

		const resolve_file_state = async (file: string) => {
			const abs = resolve_abs(file);
			try {
				const result = await get_file_state(abs);
				if (!result) {
					return {
						ok: false as const,
						error: {
							kind: 'unsupported_language' as const,
							file: abs,
							message: `No language server configured for ${abs}`,
						},
					};
				}
				return {
					ok: true as const,
					result,
				};
			} catch (error) {
				if (error instanceof LspToolError) {
					return {
						ok: false as const,
						error: error.details,
					};
				}
				return {
					ok: false as const,
					error: {
						kind: 'tool_execution_failed' as const,
						file: abs,
						message:
							error instanceof Error ? error.message : String(error),
					},
				};
			}
		};

		const with_file_state = async (
			file: string,
			run: (result: {
				abs: string;
				uri: string;
				state: ServerState;
			}) => Promise<string>,
		) => {
			const resolved = await resolve_file_state(file);
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
		};

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
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
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
					'Get language server diagnostics for multiple files in one call. Useful for package-level sweeps and summarization.',
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
				execute: async (_id, params) => {
					const results = await Promise.all(
						params.files.map((file) => resolve_file_state(file)),
					);
					const wait_ms = params.wait_ms ?? 1500;
					const lines_with_stats = await Promise.all(
						results.map(async (resolved) => {
							if (!resolved.ok) {
								return {
									line: format_tool_error(resolved.error),
									diagnostics: 0,
									error: true,
								};
							}
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
						}),
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
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
						const symbols =
							await result.state.client.document_symbols(result.uri);
						const matches = find_symbol_matches(
							symbols,
							params.query,
							{
								max_results: params.max_results ?? 20,
								top_level_only: params.top_level_only ?? false,
								exact_match: params.exact_match ?? false,
								kinds: new Set(params.kinds ?? []),
							},
						);
						return format_symbol_matches(
							result.abs,
							params.query,
							matches,
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
					line: Type.Number({
						description: 'Zero-based line number.',
					}),
					character: Type.Number({
						description: 'Zero-based character offset.',
					}),
				}),
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
						const hover = await result.state.client.hover(
							result.uri,
							{
								line: params.line,
								character: params.character,
							},
						);
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
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
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
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
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
				execute: async (_id, params) =>
					with_file_state(params.file, async (result) => {
						const symbols =
							await result.state.client.document_symbols(result.uri);
						return format_document_symbols(result.abs, symbols);
					}),
			}),
		);

		pi.registerCommand('lsp', {
			description: 'Show or manage language server state',
			getArgumentCompletions: (prefix) => {
				const parts = prefix.trim().split(/\s+/);
				const subcommands = ['status', 'list', 'restart'];
				if (!prefix.trim()) {
					return subcommands.map((value) => ({
						value,
						label: value,
					}));
				}
				if (parts.length <= 1) {
					return subcommands
						.filter((value) => value.startsWith(parts[0]))
						.map((value) => ({ value, label: value }));
				}
				if (parts[0] === 'restart') {
					const candidate = parts[1] ?? '';
					return ['all', ...list_supported_languages()]
						.filter((value) => value.startsWith(candidate))
						.map((value) => ({
							value: `restart ${value}`,
							label: value,
						}));
				}
				return null;
			},
			handler: async (args, ctx) => {
				await handle_lsp_command(
					args,
					ctx,
					cwd,
					clients_by_server,
					failed_servers,
					clear_language_state,
				);
			},
		});

		pi.on('session_shutdown', async () => {
			await clear_language_state();
		});
	};
}

export default create_lsp_extension();

async function handle_lsp_command(
	args: string,
	ctx: ExtensionCommandContext,
	cwd: string,
	clients_by_server: Map<string, ServerState>,
	failed_servers: Map<string, LspToolErrorDetails>,
	clear_language_state: (language?: string) => Promise<void>,
): Promise<void> {
	const parts = args.trim() ? args.trim().split(/\s+/, 2) : [];
	const [subcommand = 'status', target] = parts;

	switch (subcommand) {
		case 'status':
		case 'list':
			ctx.ui.notify(
				format_status_lines(
					cwd,
					clients_by_server,
					failed_servers,
				).join('\n'),
			);
			return;
		case 'restart': {
			if (!target || target === 'all') {
				await clear_language_state();
				ctx.ui.notify('Restarted all language server state.');
				return;
			}
			if (!list_supported_languages().includes(target)) {
				ctx.ui.notify(
					`Unknown language: ${target}. Use one of: ${list_supported_languages().join(', ')}`,
					'warning',
				);
				return;
			}
			await clear_language_state(target);
			ctx.ui.notify(`Restarted ${target} language server state.`);
			return;
		}
		default:
			ctx.ui.notify(
				`Unknown subcommand: ${subcommand}. Use: status, list, restart`,
				'warning',
			);
	}
}

function format_status_lines(
	cwd: string,
	clients_by_server: Map<string, ServerState>,
	failed_servers: Map<string, LspToolErrorDetails>,
): string[] {
	const lines: string[] = [];
	const active_languages = new Set<string>();
	const running_states = Array.from(clients_by_server.values()).sort(
		(a, b) =>
			a.language.localeCompare(b.language) ||
			a.workspace_root.localeCompare(b.workspace_root),
	);
	for (const running of running_states) {
		active_languages.add(running.language);
		lines.push(
			`${running.language}: running (ready=${running.client.is_ready()}) — ${running.command} [workspace ${running.workspace_root}]`,
		);
	}

	const failures = Array.from(failed_servers.values()).sort(
		(a, b) =>
			(a.language ?? '').localeCompare(b.language ?? '') ||
			(a.workspace_root ?? '').localeCompare(b.workspace_root ?? ''),
	);
	for (const failure of failures) {
		if (failure.language) {
			active_languages.add(failure.language);
		}
		const workspace = failure.workspace_root
			? ` [workspace ${failure.workspace_root}]`
			: '';
		const language = failure.language ?? 'unknown';
		lines.push(
			`${language}: failed — ${failure.message}${workspace}`,
		);
	}

	for (const language of list_supported_languages()) {
		if (active_languages.has(language)) continue;
		const config = get_server_config(language, cwd);
		if (config) {
			lines.push(`${language}: idle — ${config.command}`);
		}
	}
	return lines.length > 0
		? lines
		: ['No language servers configured for this project.'];
}

function to_lsp_tool_error(
	file: string,
	language: string,
	workspace_root: string,
	command: string,
	install_hint: string | undefined,
	error: unknown,
): LspToolErrorDetails {
	if (error instanceof LspToolError) {
		return error.details;
	}
	if (error instanceof LspClientStartError) {
		const missing_binary = error.code === 'ENOENT';
		return {
			kind: 'server_start_failed',
			file,
			language,
			workspace_root,
			command,
			install_hint,
			code: error.code,
			message: missing_binary
				? `command "${command}" not found`
				: error.message,
		};
	}
	return {
		kind: 'tool_execution_failed',
		file,
		language,
		workspace_root,
		command,
		install_hint,
		message: error instanceof Error ? error.message : String(error),
		code:
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			typeof (error as { code?: unknown }).code === 'string'
				? (error as { code: string }).code
				: undefined,
	};
}

function format_tool_error(details: LspToolErrorDetails): string {
	if (details.kind === 'unsupported_language') {
		return details.message;
	}
	const lines = [
		details.language
			? `${details.language} LSP unavailable for ${details.file}`
			: `LSP request failed for ${details.file}`,
		`Reason: ${details.message}`,
	];
	if (details.command) {
		lines.push(`Command: ${details.command}`);
	}
	if (details.workspace_root) {
		lines.push(`Workspace: ${details.workspace_root}`);
	}
	if (details.install_hint) {
		lines.push(`Hint: ${details.install_hint}`);
	}
	return lines.join('\n');
}

function severity_label(severity: LspDiagnostic['severity']): string {
	switch (severity) {
		case 1:
			return 'error';
		case 2:
			return 'warning';
		case 3:
			return 'info';
		case 4:
			return 'hint';
		default:
			return 'info';
	}
}

function format_diagnostics(
	file: string,
	diagnostics: LspDiagnostic[],
): string {
	if (diagnostics.length === 0) {
		return `${file}: no diagnostics`;
	}
	const lines = [`${file}: ${diagnostics.length} diagnostic(s)`];
	for (const d of diagnostics) {
		const position = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
		const source = d.source ? ` [${d.source}]` : '';
		const code = d.code != null ? ` (${d.code})` : '';
		lines.push(
			`  ${position} ${severity_label(d.severity)}${source}${code}: ${d.message}`,
		);
	}
	return lines.join('\n');
}

function format_hover(hover: LspHover | null): string {
	if (!hover) return 'No hover info.';
	const contents = hover.contents;
	const extract = (
		item:
			| string
			| { language?: string; value: string }
			| { kind: string; value: string },
	): string => (typeof item === 'string' ? item : (item.value ?? ''));

	if (Array.isArray(contents)) {
		return (
			contents.map(extract).join('\n\n').trim() || 'No hover info.'
		);
	}
	return extract(contents).trim() || 'No hover info.';
}

function format_locations(
	locations: LspLocation[],
	empty_message: string,
): string {
	if (locations.length === 0) return empty_message;
	return locations
		.map((loc) => {
			const path = file_url_to_path_or_value(loc.uri);
			return `${path}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
		})
		.join('\n');
}

function format_document_symbols(
	file: string,
	symbols: LspDocumentSymbol[],
): string {
	if (symbols.length === 0) {
		return `${file}: no symbols`;
	}
	const lines = [`${file}: ${symbols.length} top-level symbol(s)`];
	append_symbol_lines(lines, symbols, 1);
	return lines.join('\n');
}

function find_symbol_matches(
	symbols: LspDocumentSymbol[],
	query: string,
	options: {
		max_results: number;
		top_level_only: boolean;
		exact_match: boolean;
		kinds: ReadonlySet<string>;
	},
): Array<{ symbol: LspDocumentSymbol; depth: number }> {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [];
	const matches: Array<{ symbol: LspDocumentSymbol; depth: number }> =
		[];
	const matches_query = (symbol: LspDocumentSymbol): boolean => {
		const values = [symbol.name, symbol.detail ?? ''].map((value) =>
			value.trim().toLowerCase(),
		);
		return options.exact_match
			? values.some((value) => value === normalized)
			: values.some((value) => value.includes(normalized));
	};
	const matches_kind = (symbol: LspDocumentSymbol): boolean => {
		if (options.kinds.size === 0) return true;
		return options.kinds.has(symbol_kind_label(symbol.kind));
	};
	const visit = (
		entries: LspDocumentSymbol[],
		depth: number,
	): void => {
		for (const symbol of entries) {
			if (matches_kind(symbol) && matches_query(symbol)) {
				matches.push({ symbol, depth });
				if (matches.length >= options.max_results) {
					return;
				}
			}
			if (!options.top_level_only && symbol.children?.length) {
				visit(symbol.children, depth + 1);
				if (matches.length >= options.max_results) {
					return;
				}
			}
		}
	};
	visit(symbols, 1);
	return matches;
}

function format_symbol_matches(
	file: string,
	query: string,
	matches: Array<{ symbol: LspDocumentSymbol; depth: number }>,
): string {
	if (matches.length === 0) {
		return `${file}: no symbols matching "${query}"`;
	}
	const lines = [
		`${file}: ${matches.length} symbol match(es) for "${query}"`,
	];
	for (const { symbol, depth } of matches) {
		const indent = '  '.repeat(depth);
		const detail = symbol.detail ? ` — ${symbol.detail}` : '';
		const range = `${symbol.range.start.line + 1}:${symbol.range.start.character + 1}`;
		lines.push(
			`${indent}${symbol_kind_label(symbol.kind)} ${symbol.name}${detail} @ ${range}`,
		);
	}
	return lines.join('\n');
}

function append_symbol_lines(
	lines: string[],
	symbols: LspDocumentSymbol[],
	depth: number,
): void {
	for (const symbol of symbols) {
		const indent = '  '.repeat(depth);
		const detail = symbol.detail ? ` — ${symbol.detail}` : '';
		const range = `${symbol.range.start.line + 1}:${symbol.range.start.character + 1}`;
		lines.push(
			`${indent}${symbol_kind_label(symbol.kind)} ${symbol.name}${detail} @ ${range}`,
		);
		if (symbol.children?.length) {
			append_symbol_lines(lines, symbol.children, depth + 1);
		}
	}
}

function symbol_kind_label(kind: number): string {
	return SYMBOL_KIND_LABELS[kind] ?? 'symbol';
}

function file_url_to_path_or_value(uri: string): string {
	try {
		return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
	} catch {
		return uri;
	}
}
