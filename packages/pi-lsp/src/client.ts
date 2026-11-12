import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { create_child_process_env } from './env.js';
import * as v from 'valibot';
import {
	initialize_result_schema,
	hover_result_schema,
	definition_result_schema,
	references_result_schema,
	document_symbols_result_schema,
	diagnostic_result_schema,
} from './response-schemas.js';

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspLocation {
	uri: string;
	range: LspRange;
}

export interface LspLocationLink {
	targetUri: string;
	targetRange: LspRange;
	targetSelectionRange?: LspRange;
	originSelectionRange?: LspRange;
}

export interface LspDocumentSymbol {
	name: string;
	kind: number;
	detail?: string;
	range: LspRange;
	selectionRange: LspRange;
	children?: LspDocumentSymbol[];
	uri?: string;
	containerName?: string;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: 1 | 2 | 3 | 4;
	code?: string | number;
	source?: string;
	message: string;
}

export interface LspHover {
	contents:
		| string
		| { language?: string; value: string }
		| { kind: string; value: string }
		| Array<
				| string
				| { language?: string; value: string }
				| { kind: string; value: string }
		  >;
	range?: LspRange;
}

interface JsonRpcMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface LspClientOptions {
	command: string;
	args: string[];
	root_uri: string;
	language_id_for_uri: (uri: string) => string | undefined;
	request_timeout_ms?: number;
	initialization_options?: Record<string, unknown>;
}

export class LspClientStartError extends Error {
	command: string;
	args: string[];
	code?: string;

	constructor(
		message: string,
		options: {
			command: string;
			args: string[];
			cause?: unknown;
			code?: string;
		},
	) {
		super(
			message,
			options.cause ? { cause: options.cause } : undefined,
		);
		this.name = 'LspClientStartError';
		this.command = options.command;
		this.args = options.args;
		this.code = options.code;
	}
}

export class LspClient extends EventEmitter {
	#proc: ChildProcess | null = null;
	#options: LspClientOptions;
	#next_id = 1;
	#pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();
	#buffer = Buffer.alloc(0);
	#initialized = false;
	#supports_pull_diagnostics = false;
	#document_version = 0;
	#open_docs = new Map<string, { version: number; text: string }>();
	#diagnostics_by_uri = new Map<string, LspDiagnostic[]>();
	#diagnostic_waiters = new Set<(error: Error) => void>();

	constructor(options: LspClientOptions) {
		super();
		this.#options = options;
	}

	async start(): Promise<void> {
		this.#proc = spawn(this.#options.command, this.#options.args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_child_process_env(),
		});

		let start_reject: ((error: Error) => void) | null = null;

		const start_failure = new Promise<never>((_, reject) => {
			start_reject = reject;
		});

		const reject_start = (error: Error): boolean => {
			if (!start_reject) return false;
			const reject = start_reject;
			start_reject = null;
			reject(error);

			return true;
		};

		const start_error = (
			message: string,
			cause?: unknown,
			code?: string,
		): LspClientStartError =>
			new LspClientStartError(message, {
				command: this.#options.command,
				args: this.#options.args,
				cause,
				code,
			});

		this.#proc.on('error', (err) => {
			const wrapped = start_error(
				`Failed to spawn ${this.#options.command}`,
				err,
				error_code(err),
			);

			if (!reject_start(wrapped)) {
				this.#emit_error(wrapped);
			}
		});
		this.#proc.on('close', () => {
			if (!this.#initialized) {
				reject_start(
					start_error(
						`LSP server ${this.#options.command} closed before initialization`,
					),
				);
			}

			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error('LSP server closed'));
			}

			this.#pending.clear();
			this.#release_diagnostic_waiters(
				new Error('LSP server closed'),
			);
			this.#initialized = false;
			this.#proc = null;
		});
		this.#proc.stderr?.on('data', () => {
			// Discard stderr; many servers are chatty.
		});
		this.#proc.stdout!.on('data', (chunk: Buffer) => {
			this.#buffer = Buffer.concat([this.#buffer, chunk]);
			this.#drain_buffer();
		});

		try {
			const base_initialize_params = {
				processId: process.pid,
				rootUri: this.#options.root_uri,

				capabilities: {
					textDocument: {
						diagnostic: {},
						publishDiagnostics: {
							relatedInformation: true,
							versionSupport: true,
						},
						hover: {
							contentFormat: ['markdown', 'plaintext'],
						},
						definition: { linkSupport: false },
						references: {},
						documentSymbol: {
							hierarchicalDocumentSymbolSupport: true,
						},
					},
					workspace: {
						workspaceFolders: true,
						symbol: {},
					},
				},
				workspaceFolders: [
					{ uri: this.#options.root_uri, name: 'workspace' },
				],
			};

			const initialize_params = this.#options.initialization_options
				? {
						...base_initialize_params,
						initializationOptions:
							this.#options.initialization_options,
					}
				: base_initialize_params;

			const initialize_result = await Promise.race([
				this.#request(
					'initialize',
					initialize_params,
					initialize_result_schema,
				),
				start_failure,
			]);

			const capabilities = initialize_result?.capabilities;

			this.#supports_pull_diagnostics = Boolean(
				capabilities?.diagnosticProvider,
			);
			this.#notify('initialized', {});
			this.#initialized = true;
			start_reject = null;
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	is_ready(): boolean {
		return this.#initialized;
	}

	async ensure_document_open(
		uri: string,
		text: string,
	): Promise<void> {
		const existing = this.#open_docs.get(uri);

		if (existing?.text === text) return;
		// Never reuse a version, including after a document closes and reopens.
		const version = ++this.#document_version;
		this.#open_docs.set(uri, { version, text });
		this.#diagnostics_by_uri.delete(uri);

		if (existing) {
			this.#notify('textDocument/didChange', {
				textDocument: { uri, version },
				contentChanges: [{ text }],
			});

			return;
		}

		const language_id =
			this.#options.language_id_for_uri(uri) ?? 'plaintext';

		this.#notify('textDocument/didOpen', {
			textDocument: {
				uri,
				languageId: language_id,
				version,
				text,
			},
		});
	}

	async close_document(uri: string): Promise<void> {
		if (!this.#open_docs.has(uri)) return;
		this.#open_docs.delete(uri);
		this.#diagnostics_by_uri.delete(uri);
		this.#notify('textDocument/didClose', {
			textDocument: { uri },
		});
	}

	open_document_count(): number {
		return this.#open_docs.size;
	}

	async hover(
		uri: string,
		position: LspPosition,
	): Promise<LspHover | null> {
		const result = await this.#request(
			'textDocument/hover',
			{
				textDocument: { uri },
				position,
			},
			hover_result_schema,
		);

		return result ?? null;
	}

	async definition(
		uri: string,
		position: LspPosition,
	): Promise<LspLocation[]> {
		const result = await this.#request(
			'textDocument/definition',
			{
				textDocument: { uri },
				position,
			},
			definition_result_schema,
		);

		return normalize_location_result(result ?? null);
	}

	async references(
		uri: string,
		position: LspPosition,
		include_declaration: boolean,
	): Promise<LspLocation[]> {
		const result = await this.#request(
			'textDocument/references',
			{
				textDocument: { uri },
				position,
				context: { includeDeclaration: include_declaration },
			},
			references_result_schema,
		);

		return result ?? [];
	}

	async document_symbols(uri: string): Promise<LspDocumentSymbol[]> {
		const result = await this.#request(
			'textDocument/documentSymbol',
			{ textDocument: { uri } },
			document_symbols_result_schema,
		);

		return normalize_document_symbol_result(result ?? null);
	}

	/** Diagnostics received for the current document, or null if none arrived. */
	get_diagnostics(uri: string): LspDiagnostic[] | null {
		return this.#diagnostics_by_uri.get(uri) ?? null;
	}

	/**
	 * Resolves with the diagnostics the server supplied for the current
	 * document; an empty array is an explicit clean result. Resolves with
	 * null when no result arrived before the deadline, and rejects when the
	 * client stops or the server closes while waiting.
	 */
	async wait_for_diagnostics(
		uri: string,
		timeout_ms = 1500,
	): Promise<LspDiagnostic[] | null> {
		const document = this.#open_docs.get(uri);

		if (!document) return null;
		const cached = this.get_diagnostics(uri);

		if (cached) return cached;

		if (this.#supports_pull_diagnostics) {
			const response = await this.#request(
				'textDocument/diagnostic',
				{ textDocument: { uri } },
				diagnostic_result_schema,
				timeout_ms,
			);

			if (
				this.#open_docs.get(uri) !== document ||
				!Array.isArray(response?.items)
			)
				return null;
			this.#diagnostics_by_uri.set(uri, response.items);

			return response.items;
		}

		return new Promise((resolve, reject) => {
			let active = true;

			const cleanup = (): boolean => {
				if (!active) return false;
				active = false;
				this.off('diagnostics', handler);
				clearTimeout(timer);
				this.#diagnostic_waiters.delete(release);

				return true;
			};

			const settle = () => {
				if (cleanup()) {
					resolve(
						this.#open_docs.get(uri) === document
							? this.get_diagnostics(uri)
							: null,
					);
				}
			};

			const release = (error: Error) => {
				if (cleanup()) reject(error);
			};

			const handler = (event_uri: string) => {
				if (event_uri !== uri) return;
				settle();
			};

			const timer = setTimeout(settle, timeout_ms);
			this.on('diagnostics', handler);
			this.#diagnostic_waiters.add(release);
		});
	}

	async stop(): Promise<void> {
		if (this.#initialized) {
			try {
				await this.#request(
					'shutdown',
					null,
					v.pipe(
						v.unknown(),
						v.transform(() => {}),
					),
					1000,
				);
				this.#notify('exit', null);
			} catch {
				// Server may already be dead; proceed.
			}
		}

		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('LSP client stopped'));
		}

		this.#pending.clear();
		this.#release_diagnostic_waiters(new Error('LSP client stopped'));
		this.#open_docs.clear();
		this.#diagnostics_by_uri.clear();

		if (this.#proc) {
			this.#proc.kill();
			this.#proc = null;
		}

		this.#initialized = false;
		this.#supports_pull_diagnostics = false;
	}

	#release_diagnostic_waiters(error: Error): void {
		for (const release of Array.from(this.#diagnostic_waiters)) {
			release(error);
		}
	}

	#request<T>(
		method: string,
		params: unknown,
		result_schema: v.GenericSchema<unknown, T>,
		timeout_override?: number,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const id = this.#next_id++;

			const timeout_ms =
				timeout_override ??
				this.#options.request_timeout_ms ??
				30_000;

			const timer = setTimeout(() => {
				if (this.#pending.has(id)) {
					this.#pending.delete(id);
					reject(new Error(`LSP request ${method} timed out`));
				}
			}, timeout_ms);

			this.#pending.set(id, {
				resolve: (result) => {
					try {
						resolve(v.parse(result_schema, result));
					} catch (error) {
						reject(error);
					}
				},
				reject,
				timer,
			});

			try {
				this.#send({ jsonrpc: '2.0', id, method, params });
			} catch (error) {
				clearTimeout(timer);
				this.#pending.delete(id);
				reject(error as Error);
			}
		});
	}

	#notify(method: string, params: unknown): void {
		this.#send({ jsonrpc: '2.0', method, params });
	}

	#send(message: JsonRpcMessage): void {
		if (!this.#proc?.stdin?.writable) {
			throw new Error('LSP server not connected');
		}

		const body = Buffer.from(JSON.stringify(message), 'utf8');

		const header = Buffer.from(
			`Content-Length: ${body.length}\r\n\r\n`,
			'ascii',
		);

		this.#proc.stdin.write(Buffer.concat([header, body]));
	}

	#emit_error(error: unknown): void {
		if (this.listenerCount('error') > 0) {
			this.emit('error', error);
		}
	}

	#drain_buffer(): void {
		while (true) {
			const header_end = this.#buffer.indexOf('\r\n\r\n');

			if (header_end === -1) return;

			const header = this.#buffer
				.subarray(0, header_end)
				.toString('ascii');

			const match = header.match(/Content-Length:\s*(\d+)/i);

			if (!match) {
				this.#buffer = this.#buffer.subarray(header_end + 4);
				continue;
			}

			const length = Number(match[1]);
			const body_start = header_end + 4;

			if (this.#buffer.length < body_start + length) return;

			const body = this.#buffer.subarray(
				body_start,
				body_start + length,
			);

			this.#buffer = this.#buffer.subarray(body_start + length);

			try {
				this.#handle_message(
					JSON.parse(body.toString('utf8')) as JsonRpcMessage,
				);
			} catch (error) {
				this.#emit_error(error);
			}
		}
	}

	#handle_message(message: JsonRpcMessage): void {
		let numeric_id: number | null = null;

		if (typeof message.id === 'number') numeric_id = message.id;
		else if (
			typeof message.id === 'string' &&
			/^-?\d+$/.test(message.id)
		)
			numeric_id = Number(message.id);

		if (numeric_id != null && this.#pending.has(numeric_id)) {
			const pending = this.#pending.get(numeric_id)!;
			this.#pending.delete(numeric_id);
			clearTimeout(pending.timer);

			if (message.error) {
				pending.reject(
					new Error(
						`LSP error ${message.error.code}: ${message.error.message}`,
					),
				);
			} else {
				pending.resolve(message.result);
			}

			return;
		}

		if (
			message.method === 'textDocument/publishDiagnostics' &&
			message.params
		) {
			const params = message.params as {
				uri: string;
				version?: number | null;
				diagnostics: LspDiagnostic[];
			};

			// Diagnostics for a closed document or an earlier version are
			// stale; they must not answer for the current text.
			const open_doc = this.#open_docs.get(params.uri);

			if (!open_doc) return;

			if (
				typeof params.version === 'number' &&
				params.version !== open_doc.version
			) {
				return;
			}

			this.#diagnostics_by_uri.set(params.uri, params.diagnostics);
			this.emit('diagnostics', params.uri);

			return;
		}

		if (message.method && message.id != null) {
			// Respond to server-to-client requests we don't implement so it doesn't block.
			this.#send({
				jsonrpc: '2.0',
				id: message.id,
				result: null,
			});
		}
	}
}

export function normalize_location_result(
	result:
		| LspLocation
		| LspLocation[]
		| LspLocationLink
		| LspLocationLink[]
		| null,
): LspLocation[] {
	if (!result) return [];
	const entries = Array.isArray(result) ? result : [result];

	return entries.map((entry) => {
		if ('uri' in entry) return entry;

		return {
			uri: entry.targetUri,
			range: entry.targetSelectionRange ?? entry.targetRange,
		};
	});
}

export function normalize_document_symbol_result(
	result:
		| LspDocumentSymbol[]
		| Array<{
				name: string;
				kind: number;
				location: LspLocation;
				containerName?: string;
		  }>
		| null,
): LspDocumentSymbol[] {
	if (!result) return [];

	if (
		result.length === 0 ||
		('range' in result[0] && 'selectionRange' in result[0])
	) {
		return result as LspDocumentSymbol[];
	}

	const symbol_info = result as Array<{
		name: string;
		kind: number;
		location: LspLocation;
		containerName?: string;
	}>;

	return symbol_info.map((entry) => ({
		name: entry.name,
		kind: entry.kind,
		range: entry.location.range,
		selectionRange: entry.location.range,
		containerName: entry.containerName,
		uri: entry.location.uri,
	}));
}

export function file_path_to_uri(file_path: string): string {
	return pathToFileURL(file_path).href;
}

function error_code(error: unknown): string | undefined {
	return typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof (error as { code?: unknown }).code === 'string'
		? (error as { code: string }).code
		: undefined;
}
