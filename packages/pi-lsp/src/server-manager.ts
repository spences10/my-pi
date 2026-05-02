import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { resolve_project_trust } from '@spences10/pi-project-trust';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
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
	LspToolError,
	to_lsp_tool_error,
	type LspToolErrorDetails,
} from './format.js';
import {
	detect_language,
	find_workspace_root,
	get_server_config,
	language_id_for_file,
	type LspServerConfig,
} from './servers.js';
import {
	create_lsp_binary_trust_subject,
	default_lsp_trust_store_path,
	is_lsp_binary_trusted,
} from './trust.js';

const LSP_PROJECT_BINARY_ENV = 'MY_PI_LSP_PROJECT_BINARY';

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

export interface ServerState {
	client: LspClientLike;
	language: string;
	workspace_root: string;
	root_uri: string;
	command: string;
	install_hint?: string;
}

interface StartingServerState {
	cancelled: boolean;
	promise: Promise<ServerState | undefined>;
}

export interface FileState {
	abs: string;
	uri: string;
	state: ServerState;
}

export type ResolveFileStateResult =
	| { ok: true; result: FileState }
	| { ok: false; error: LspToolErrorDetails };

export interface CreateLspServerManagerOptions {
	create_client?: (options: LspClientOptions) => LspClientLike;
	read_file?: (path: string) => Promise<string>;
	cwd?: () => string;
}

class LspStartupCancelledError extends Error {
	constructor(language: string, workspace_root: string) {
		super(
			`Startup cancelled for ${language} LSP in ${workspace_root}`,
		);
		this.name = 'LspStartupCancelledError';
	}
}

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

export class LspServerManager {
	readonly cwd: string;
	readonly clients_by_server = new Map<string, ServerState>();
	readonly failed_servers = new Map<string, LspToolErrorDetails>();

	readonly #create_client: (
		options: LspClientOptions,
	) => LspClientLike;
	readonly #read_file: (path: string) => Promise<string>;
	readonly #starting_servers = new Map<string, StartingServerState>();

	constructor(options: CreateLspServerManagerOptions = {}) {
		this.cwd = options.cwd?.() ?? process.cwd();
		this.#create_client =
			options.create_client ??
			((client_options: LspClientOptions) =>
				new LspClient(client_options));
		this.#read_file =
			options.read_file ??
			((path: string) => readFile(path, 'utf-8'));
	}

	resolve_abs(file: string): string {
		return isAbsolute(file) ? file : resolve(this.cwd, file);
	}

	async clear_language_state(language?: string): Promise<void> {
		const states = language
			? Array.from(this.clients_by_server.entries()).filter(
					([, state]) => state.language === language,
				)
			: Array.from(this.clients_by_server.entries());
		const starting = language
			? Array.from(this.#starting_servers.entries()).filter(([key]) =>
					key.startsWith(`${language}\u0000`),
				)
			: Array.from(this.#starting_servers.entries());
		for (const [key, startup] of starting) {
			startup.cancelled = true;
			this.#starting_servers.delete(key);
		}
		await Promise.allSettled(
			states.map(([, state]) => state.client.stop()),
		);
		for (const [key] of states) {
			this.clients_by_server.delete(key);
		}

		if (!language) {
			this.failed_servers.clear();
			return;
		}
		for (const [key, failure] of this.failed_servers.entries()) {
			if (failure.language === language) {
				this.failed_servers.delete(key);
			}
		}
	}

	async resolve_file_state(
		file: string,
		ctx?: ExtensionContext,
	): Promise<ResolveFileStateResult> {
		const abs = this.resolve_abs(file);
		try {
			const result = await this.#get_file_state(abs, ctx);
			if (!result) {
				return {
					ok: false,
					error: {
						kind: 'unsupported_language',
						file: abs,
						message: `No language server configured for ${abs}`,
					},
				};
			}
			return { ok: true, result };
		} catch (error) {
			if (error instanceof LspToolError) {
				return { ok: false, error: error.details };
			}
			return {
				ok: false,
				error: {
					kind: 'tool_execution_failed',
					file: abs,
					message:
						error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	async #get_file_state(
		file: string,
		ctx?: ExtensionContext,
	): Promise<FileState | undefined> {
		const abs = this.resolve_abs(file);
		const state = await this.#get_or_start_client(abs, ctx);
		if (!state) return undefined;
		const uri = await this.#open_file(state, abs);
		return { abs, uri, state };
	}

	async #get_or_start_client(
		file_path: string,
		ctx?: ExtensionContext,
	): Promise<ServerState | undefined> {
		const language = detect_language(file_path);
		if (!language) return undefined;
		const workspace_root = find_workspace_root(file_path, this.cwd);
		const key = `${language}\u0000${workspace_root}`;
		const existing = this.clients_by_server.get(key);
		if (existing) return existing;
		const failed = this.failed_servers.get(key);
		if (failed) {
			throw new LspToolError(failed);
		}
		const in_flight = this.#starting_servers.get(key);
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
			const client = this.#create_client({
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
				this.failed_servers.set(key, failure);
				throw new LspToolError(failure);
			}

			if (startup.cancelled) {
				await Promise.allSettled([client.stop()]);
				throw new LspStartupCancelledError(language, workspace_root);
			}

			const state: ServerState = {
				client,
				language,
				workspace_root,
				root_uri,
				command: server_config.command,
				install_hint: server_config.install_hint,
			};
			this.clients_by_server.set(key, state);
			this.failed_servers.delete(key);
			return state;
		})();

		startup.promise = start_promise;
		this.#starting_servers.set(key, startup);
		try {
			return await start_promise;
		} finally {
			if (this.#starting_servers.get(key) === startup) {
				this.#starting_servers.delete(key);
			}
		}
	}

	async #open_file(
		state: ServerState,
		abs_path: string,
	): Promise<string> {
		const text = await this.#read_file(abs_path);
		const uri = file_path_to_uri(abs_path);
		await state.client.ensure_document_open(uri, text);
		return uri;
	}
}
