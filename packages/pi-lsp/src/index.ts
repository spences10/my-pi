import {
	defineTool,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { resolve_project_trust } from '@spences10/pi-project-trust';
import {
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { Type } from 'typebox';
import {
	file_path_to_uri,
	LspClient,
	type LspClientOptions,
	type LspDiagnostic,
	type LspDocumentSymbol,
	type LspHover,
	type LspLocation,
	type LspPosition,
} from './client.js';
import {
	find_symbol_matches,
	format_diagnostics,
	format_document_symbols,
	format_hover,
	format_locations,
	format_lsp_view,
	format_status_lines,
	format_symbol_matches,
	format_tool_error,
	LspToolError,
	SYMBOL_KIND_NAMES,
	SYMBOL_KIND_SCHEMA,
	to_lsp_tool_error,
	type LspToolErrorDetails,
} from './format.js';
import {
	detect_language,
	find_workspace_root,
	get_server_config,
	language_id_for_file,
	list_supported_languages,
	type LspServerConfig,
} from './servers.js';
import {
	create_lsp_binary_trust_subject,
	default_lsp_trust_store_path,
	is_lsp_binary_trusted,
} from './trust.js';

interface ServerState {
	client: LspClientLike;
	language: string;
	workspace_root: string;
	root_uri: string;
	command: string;
	install_hint?: string;
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

const LSP_TOOL_NAMES = new Set([
	'lsp_diagnostics',
	'lsp_diagnostics_many',
	'lsp_find_symbol',
	'lsp_hover',
	'lsp_definition',
	'lsp_references',
	'lsp_document_symbols',
]);

const DIAGNOSTICS_MANY_CONCURRENCY = 8;
const LSP_PROJECT_BINARY_ENV = 'MY_PI_LSP_PROJECT_BINARY';

async function should_use_project_lsp_binary(
	server_config: LspServerConfig,
	ctx?: ExtensionContext,
): Promise<boolean> {
	if (!server_config.is_project_local) return true;
	if (is_lsp_binary_trusted(server_config.command)) return true;

	const subject = {
		...create_lsp_binary_trust_subject(server_config.command),
		prompt_title:
			'Project-local language server binaries can execute code.\nTrust this LSP binary?',
		summary_lines: [
			`Language: ${server_config.language}`,
			`Binary: ${server_config.command}`,
		],
		headless_warning: `Skipping untrusted project-local LSP binary: ${server_config.command}. Set ${LSP_PROJECT_BINARY_ENV}=allow to enable it for this run.`,
	};
	const decision = await resolve_project_trust(subject, {
		env: process.env,
		has_ui: ctx?.hasUI,
		select: ctx?.hasUI
			? async (message, choices) =>
					(await ctx.ui.select(message, choices)) ?? ''
			: undefined,
		warn: console.warn,
		trust_store_path: default_lsp_trust_store_path(),
	});

	return (
		decision.action === 'allow-once' ||
		decision.action === 'trust-persisted'
	);
}

export function should_inject_lsp_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools ||
		selected_tools.some((tool) => LSP_TOOL_NAMES.has(tool))
	);
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
			ctx?: ExtensionContext,
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

			let server_config = get_server_config(language, workspace_root);
			if (!server_config) return undefined;
			if (
				server_config.is_project_local &&
				!(await should_use_project_lsp_binary(server_config, ctx))
			) {
				server_config = get_server_config(language, '/');
				if (!server_config) return undefined;
			}
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
			ctx?: ExtensionContext,
		): Promise<
			| {
					abs: string;
					uri: string;
					state: ServerState;
			  }
			| undefined
		> => {
			const abs = resolve_abs(file);
			const state = await get_or_start_client(abs, ctx);
			if (!state) return undefined;
			const uri = await open_file(state, abs);
			return { abs, uri, state };
		};

		const resolve_file_state = async (
			file: string,
			ctx?: ExtensionContext,
		) => {
			const abs = resolve_abs(file);
			try {
				const result = await get_file_state(abs, ctx);
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
			ctx: ExtensionContext,
			run: (result: {
				abs: string;
				uri: string;
				state: ServerState;
			}) => Promise<string>,
		) => {
			const resolved = await resolve_file_state(file, ctx);
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
				execute: async (_id, params, _signal, _on_update, ctx) =>
					with_file_state(params.file, ctx, async (result) => {
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
				execute: async (_id, params, _signal, _on_update, ctx) => {
					const wait_ms = params.wait_ms ?? 1500;
					const lines_with_stats = await map_with_concurrency(
						params.files,
						DIAGNOSTICS_MANY_CONCURRENCY,
						async (file) => {
							const resolved = await resolve_file_state(file, ctx);
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
					with_file_state(params.file, ctx, async (result) => {
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
				execute: async (_id, params, _signal, _on_update, ctx) =>
					with_file_state(params.file, ctx, async (result) => {
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
				execute: async (_id, params, _signal, _on_update, ctx) =>
					with_file_state(params.file, ctx, async (result) => {
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
				execute: async (_id, params, _signal, _on_update, ctx) =>
					with_file_state(params.file, ctx, async (result) => {
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
				execute: async (_id, params, _signal, _on_update, ctx) =>
					with_file_state(params.file, ctx, async (result) => {
						const symbols =
							await result.state.client.document_symbols(result.uri);
						return format_document_symbols(result.abs, symbols);
					}),
			}),
		);

		pi.on(
			'before_agent_start',
			async (event: BeforeAgentStartEvent) => {
				if (!should_inject_lsp_prompt(event)) return {};
				return {
					systemPrompt:
						event.systemPrompt +
						`

## Language server support via LSP tools

You have access to Language Server Protocol tools for diagnostics, hover/type information, definitions, references, and document symbols. Use them when:
- Debugging TypeScript, JavaScript, Svelte, or other language-server-supported errors
- Checking types, symbol definitions, or API documentation from code
- Finding references more precisely than text search
- Validating focused code changes before reporting completion

Prefer LSP diagnostics over guessing from build output when a file-level check is enough. Use text search for broad discovery, then LSP tools for precise type and symbol questions.`,
				};
			},
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
	if (parts.length === 0 && has_modal_ui(ctx)) {
		while (true) {
			const selected = await show_lsp_home_modal(
				ctx,
				cwd,
				clients_by_server,
				failed_servers,
			);
			if (!selected) return;
			if (selected === 'restart') {
				await handle_lsp_restart_modal(ctx, clear_language_state);
				continue;
			}
			if (selected === 'restart-all') {
				await restart_all_lsp_servers(ctx, clear_language_state);
				continue;
			}
			await show_lsp_text_modal(
				ctx,
				selected === 'running'
					? 'Running LSP servers'
					: selected === 'failed'
						? 'Failed LSP servers'
						: 'LSP status',
				format_lsp_view(
					selected,
					cwd,
					clients_by_server,
					failed_servers,
				),
			);
		}
	}

	const [subcommand = 'status', target] = parts;

	switch (subcommand) {
		case 'status':
		case 'list':
			await present_lsp_text(
				ctx,
				'LSP status',
				format_status_lines(
					cwd,
					clients_by_server,
					failed_servers,
				).join('\n'),
			);
			return;
		case 'restart': {
			if (!target && has_modal_ui(ctx)) {
				await handle_lsp_restart_modal(ctx, clear_language_state);
				return;
			}
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

function has_modal_ui(ctx: ExtensionCommandContext): boolean {
	return ctx.hasUI && typeof ctx.ui.custom === 'function';
}

async function present_lsp_text(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	if (has_modal_ui(ctx)) {
		await show_lsp_text_modal(ctx, title, text);
		return;
	}
	ctx.ui.notify(text);
}

async function show_lsp_home_modal(
	ctx: ExtensionCommandContext,
	cwd: string,
	clients_by_server: Map<string, ServerState>,
	failed_servers: Map<string, LspToolErrorDetails>,
): Promise<string | undefined> {
	const running_count = clients_by_server.size;
	const failed_count = failed_servers.size;
	return await show_picker_modal(ctx, {
		title: 'Language servers',
		subtitle: `${running_count} running • ${failed_count} failed • ${list_supported_languages().length} supported`,
		items: [
			{
				value: 'status',
				label: 'Status',
				description: `All configured language servers for ${cwd}`,
			},
			{
				value: 'running',
				label: 'Running servers',
				description: `${running_count} active workspace server(s)`,
			},
			{
				value: 'failed',
				label: 'Failed servers',
				description: `${failed_count} failed server(s)`,
			},
			{
				value: 'restart',
				label: 'Restart server',
				description: 'Pick a supported language to restart',
			},
			{
				value: 'restart-all',
				label: 'Restart all',
				description: 'Stop every running language server',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}

async function show_lsp_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_text_modal(ctx, {
		title,
		text,
		max_visible_lines: 20,
		overlay_options: { width: '90%', minWidth: 72 },
	});
}

async function handle_lsp_restart_modal(
	ctx: ExtensionCommandContext,
	clear_language_state: (language?: string) => Promise<void>,
): Promise<void> {
	const selected = await show_picker_modal(ctx, {
		title: 'Restart LSP server',
		subtitle: 'Clear cached language server state',
		items: [
			{
				value: 'all',
				label: 'All servers',
				description: 'Stop every running language server',
			},
			...list_supported_languages().map((language) => ({
				value: language,
				label: language,
				description: `Restart ${language} language server state`,
			})),
		],
		footer: 'enter restarts • esc back',
	});
	if (!selected) return;
	if (selected === 'all') {
		await restart_all_lsp_servers(ctx, clear_language_state);
		return;
	}
	await clear_language_state(selected);
	ctx.ui.notify(`Restarted ${selected} language server state.`);
}

async function restart_all_lsp_servers(
	ctx: ExtensionCommandContext,
	clear_language_state: (language?: string) => Promise<void>,
): Promise<void> {
	await clear_language_state();
	ctx.ui.notify('Restarted all language server state.');
}
