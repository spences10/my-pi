import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import {
	LspClientStartError,
	type LspDiagnostic,
	type LspDocumentSymbol,
	type LspHover,
	type LspLocation,
} from './client.js';
import {
	get_server_config,
	list_supported_languages,
} from './servers.js';

export interface LspFormatServerState {
	client: { is_ready(): boolean };
	language: string;
	workspace_root: string;
	command: string;
}

export interface LspToolErrorDetails {
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

export class LspToolError extends Error {
	details: LspToolErrorDetails;

	constructor(details: LspToolErrorDetails) {
		super(details.message);
		this.name = 'LspToolError';
		this.details = details;
	}
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

export const SYMBOL_KIND_NAMES = Object.values(SYMBOL_KIND_LABELS);
export const SYMBOL_KIND_SCHEMA = Type.Union(
	SYMBOL_KIND_NAMES.map((name) => Type.Literal(name)),
);

export function format_lsp_view(
	view: string,
	cwd: string,
	clients_by_server: Map<string, LspFormatServerState>,
	failed_servers: Map<string, LspToolErrorDetails>,
): string {
	if (view === 'running') {
		const lines = format_running_server_lines(clients_by_server);
		return lines.length > 0
			? lines.join('\n')
			: 'No running language servers.';
	}
	if (view === 'failed') {
		const lines = format_failed_server_lines(failed_servers);
		return lines.length > 0
			? lines.join('\n')
			: 'No failed language servers.';
	}
	return format_status_lines(
		cwd,
		clients_by_server,
		failed_servers,
	).join('\n');
}

function format_running_server_lines(
	clients_by_server: Map<string, LspFormatServerState>,
): string[] {
	return Array.from(clients_by_server.values())
		.sort(
			(a, b) =>
				a.language.localeCompare(b.language) ||
				a.workspace_root.localeCompare(b.workspace_root),
		)
		.map(
			(state) =>
				`${state.language}: running (ready=${state.client.is_ready()}) — ${state.command} [workspace ${state.workspace_root}]`,
		);
}

function format_failed_server_lines(
	failed_servers: Map<string, LspToolErrorDetails>,
): string[] {
	return Array.from(failed_servers.values())
		.sort(
			(a, b) =>
				(a.language ?? '').localeCompare(b.language ?? '') ||
				(a.workspace_root ?? '').localeCompare(
					b.workspace_root ?? '',
				),
		)
		.map((failure) => {
			const workspace = failure.workspace_root
				? ` [workspace ${failure.workspace_root}]`
				: '';
			return `${failure.language ?? 'unknown'}: failed — ${failure.message}${workspace}`;
		});
}

export function format_status_lines(
	cwd: string,
	clients_by_server: Map<string, LspFormatServerState>,
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

export function to_lsp_tool_error(
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

export function format_tool_error(
	details: LspToolErrorDetails,
): string {
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

export function format_diagnostics(
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

export function format_hover(hover: LspHover | null): string {
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

export function format_locations(
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

export function format_document_symbols(
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

export function find_symbol_matches(
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

export function format_symbol_matches(
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
