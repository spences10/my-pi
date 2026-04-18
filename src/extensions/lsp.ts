import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	file_path_to_uri,
	LspClient,
	type LspClientOptions,
	type LspDiagnostic,
	type LspDocumentSymbol,
	type LspHover,
	type LspLocation,
	type LspPosition,
} from '../lsp/client.js';
import {
	detect_language,
	get_server_config,
	language_id_for_file,
	list_supported_languages,
} from '../lsp/servers.js';

interface ServerState {
	client: LspClientLike;
	language: string;
	root_uri: string;
	command: string;
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
		const root_uri = file_path_to_uri(cwd);
		const clients_by_language = new Map<string, ServerState>();
		const failed_languages = new Map<string, string>();

		const resolve_abs = (file: string): string =>
			isAbsolute(file) ? file : resolve(cwd, file);

		const clear_language_state = async (
			language?: string,
		): Promise<void> => {
			if (language) {
				const state = clients_by_language.get(language);
				if (state) {
					await state.client.stop();
					clients_by_language.delete(language);
				}
				failed_languages.delete(language);
				return;
			}

			await Promise.allSettled(
				Array.from(clients_by_language.values()).map((state) =>
					state.client.stop(),
				),
			);
			clients_by_language.clear();
			failed_languages.clear();
		};

		const get_or_start_client = async (
			file_path: string,
		): Promise<ServerState | undefined> => {
			const language = detect_language(file_path);
			if (!language) return undefined;
			const existing = clients_by_language.get(language);
			if (existing) return existing;
			if (failed_languages.has(language)) {
				throw new Error(failed_languages.get(language)!);
			}

			const server_config = get_server_config(language, cwd);
			if (!server_config) return undefined;

			const client = create_client({
				command: server_config.command,
				args: server_config.args,
				root_uri,
				language_id_for_uri: (uri) => language_id_for_file(uri),
			});

			try {
				await client.start();
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				const failure = `Failed to start ${server_config.command} for ${language}: ${message}. Install the language server and ensure it is available.`;
				failed_languages.set(language, failure);
				throw new Error(failure);
			}

			const state: ServerState = {
				client,
				language,
				root_uri,
				command: server_config.command,
			};
			clients_by_language.set(language, state);
			failed_languages.delete(language);
			return state;
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
				execute: async (_id, params) => {
					const result = await get_file_state(params.file);
					if (!result) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `No language server configured for ${resolve_abs(params.file)}`,
								},
							],
							details: {},
						};
					}
					const diagnostics =
						await result.state.client.wait_for_diagnostics(
							result.uri,
							params.wait_ms ?? 1500,
						);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_diagnostics(result.abs, diagnostics),
							},
						],
						details: {},
					};
				},
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
				execute: async (_id, params) => {
					const result = await get_file_state(params.file);
					if (!result) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `No language server configured for ${resolve_abs(params.file)}`,
								},
							],
							details: {},
						};
					}
					const hover = await result.state.client.hover(result.uri, {
						line: params.line,
						character: params.character,
					});
					return {
						content: [
							{
								type: 'text' as const,
								text: format_hover(hover),
							},
						],
						details: {},
					};
				},
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
				execute: async (_id, params) => {
					const result = await get_file_state(params.file);
					if (!result) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `No language server configured for ${resolve_abs(params.file)}`,
								},
							],
							details: {},
						};
					}
					const locations = await result.state.client.definition(
						result.uri,
						{
							line: params.line,
							character: params.character,
						},
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_locations(
									locations,
									'No definition found.',
								),
							},
						],
						details: {},
					};
				},
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
				execute: async (_id, params) => {
					const result = await get_file_state(params.file);
					if (!result) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `No language server configured for ${resolve_abs(params.file)}`,
								},
							],
							details: {},
						};
					}
					const locations = await result.state.client.references(
						result.uri,
						{ line: params.line, character: params.character },
						params.include_declaration ?? true,
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_locations(
									locations,
									'No references found.',
								),
							},
						],
						details: {},
					};
				},
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
				execute: async (_id, params) => {
					const result = await get_file_state(params.file);
					if (!result) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `No language server configured for ${resolve_abs(params.file)}`,
								},
							],
							details: {},
						};
					}
					const symbols = await result.state.client.document_symbols(
						result.uri,
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_document_symbols(result.abs, symbols),
							},
						],
						details: {},
					};
				},
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
					clients_by_language,
					failed_languages,
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
	clients_by_language: Map<string, ServerState>,
	failed_languages: Map<string, string>,
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
					clients_by_language,
					failed_languages,
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
	clients_by_language: Map<string, ServerState>,
	failed_languages: Map<string, string>,
): string[] {
	const lines: string[] = [];
	for (const language of list_supported_languages()) {
		const running = clients_by_language.get(language);
		if (running) {
			lines.push(
				`${language}: running (ready=${running.client.is_ready()}) — ${running.command}`,
			);
			continue;
		}

		const failed = failed_languages.get(language);
		if (failed) {
			lines.push(`${language}: failed — ${failed}`);
			continue;
		}

		const config = get_server_config(language, cwd);
		if (config) {
			lines.push(`${language}: idle — ${config.command}`);
		}
	}
	return lines.length > 0
		? lines
		: ['No language servers configured for this project.'];
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
	const labels: Record<number, string> = {
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
	return labels[kind] ?? 'symbol';
}

function file_url_to_path_or_value(uri: string): string {
	try {
		return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
	} catch {
		return uri;
	}
}
