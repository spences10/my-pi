import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	load_telemetry_config,
	resolve_telemetry_db_path,
	resolve_telemetry_enabled,
	save_telemetry_config,
	type TelemetryConfig,
} from './telemetry-config.js';
import type {
	TelemetryDatabase,
	TelemetryQueryFilters,
	TelemetryRunSummary,
	TelemetryStats,
} from './telemetry-db.js';

interface TelemetryStore {
	insert_run: TelemetryDatabase['insert_run'];
	finish_run: TelemetryDatabase['finish_run'];
	insert_turn: TelemetryDatabase['insert_turn'];
	finish_turn: TelemetryDatabase['finish_turn'];
	insert_tool_call: TelemetryDatabase['insert_tool_call'];
	note_tool_update: TelemetryDatabase['note_tool_update'];
	finish_tool_call: TelemetryDatabase['finish_tool_call'];
	insert_provider_request: TelemetryDatabase['insert_provider_request'];
	finish_provider_request: TelemetryDatabase['finish_provider_request'];
	get_stats: TelemetryDatabase['get_stats'];
	query_runs: TelemetryDatabase['query_runs'];
	close: TelemetryDatabase['close'];
}

export interface CreateTelemetryExtensionOptions {
	enabled?: boolean;
	db_path?: string;
	cwd?: string;
	load_store?: (db_path: string) => Promise<TelemetryStore>;
	now?: () => number;
}

interface EvalMetadata {
	run_id: string | null;
	case_id: string | null;
	attempt: number | null;
	suite: string | null;
}

interface ActiveRun {
	id: string;
}

interface ActiveTurn {
	id: string;
}

const COMMANDS = [
	'status',
	'stats',
	'query',
	'export',
	'on',
	'off',
	'path',
];
const DEFAULT_QUERY_LIMIT = 20;

function parse_int(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function get_eval_metadata(): EvalMetadata {
	return {
		run_id: process.env.MY_PI_EVAL_RUN_ID ?? null,
		case_id: process.env.MY_PI_EVAL_CASE_ID ?? null,
		attempt: parse_int(process.env.MY_PI_EVAL_ATTEMPT),
		suite: process.env.MY_PI_EVAL_SUITE ?? null,
	};
}

function get_model_identity(model: ExtensionContext['model']): {
	provider: string | null;
	id: string | null;
} {
	if (!model) {
		return { provider: null, id: null };
	}
	return {
		provider:
			typeof model.provider === 'string' ? model.provider : null,
		id: typeof model.id === 'string' ? model.id : null,
	};
}

function get_session_file(ctx: ExtensionContext): string | null {
	const session_manager = ctx.sessionManager as {
		getSessionFile?: () => string | undefined;
	};
	return session_manager.getSessionFile?.() ?? null;
}

function safe_json_stringify(value: unknown): string | null {
	if (value === undefined) return null;
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({
			type: typeof value,
			unserializable: true,
		});
	}
}

function summarize_value(value: unknown, depth = 0): unknown {
	if (value == null) return null;
	if (typeof value === 'string') {
		return {
			type: 'string',
			bytes: Buffer.byteLength(value, 'utf-8'),
			lines: value === '' ? 0 : value.split(/\r?\n/).length,
		};
	}
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return value;
	}
	if (Array.isArray(value)) {
		return {
			type: 'array',
			length: value.length,
			items:
				depth >= 1
					? undefined
					: value
							.slice(0, 5)
							.map((item) => summarize_value(item, depth + 1)),
		};
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		const summary: Record<string, unknown> = {
			type: 'object',
			keys: entries.map(([key]) => key).slice(0, 20),
		};
		if (depth < 1) {
			for (const [key, child] of entries.slice(0, 10)) {
				if (
					key === 'oldText' ||
					key === 'newText' ||
					key === 'content' ||
					key === 'text'
				) {
					summary[`${key}_summary`] = summarize_value(
						child,
						depth + 1,
					);
					continue;
				}
				summary[key] = summarize_value(child, depth + 1);
			}
		}
		return summary;
	}
	return {
		type: typeof value,
	};
}

function summarize_tool_args(
	tool_name: string,
	args: unknown,
): string | null {
	if (!args || typeof args !== 'object') {
		return safe_json_stringify(summarize_value(args));
	}

	const input = args as Record<string, unknown>;
	switch (tool_name) {
		case 'bash':
			return safe_json_stringify({
				tool: tool_name,
				timeout: input.timeout ?? null,
				command: summarize_value(input.command),
			});
		case 'read':
		case 'write':
		case 'edit':
			return safe_json_stringify({
				tool: tool_name,
				path: typeof input.path === 'string' ? input.path : null,
				offset:
					typeof input.offset === 'number' ? input.offset : null,
				limit: typeof input.limit === 'number' ? input.limit : null,
				content: summarize_value(input.content),
				edits: summarize_value(input.edits),
			});
		default:
			return safe_json_stringify({
				tool: tool_name,
				summary: summarize_value(args),
			});
	}
}

function summarize_tool_result(result: unknown): string | null {
	return safe_json_stringify(summarize_value(result));
}

function summarize_headers(
	headers: Record<string, string>,
): string | null {
	return safe_json_stringify({
		keys: Object.keys(headers).slice(0, 20),
		count: Object.keys(headers).length,
	});
}

function summarize_provider_payload(payload: unknown): string | null {
	return safe_json_stringify(summarize_value(payload));
}

function get_stop_reason(message: unknown): string | null {
	if (!message || typeof message !== 'object') return null;
	const stop_reason = (message as { stopReason?: unknown })
		.stopReason;
	return typeof stop_reason === 'string' ? stop_reason : null;
}

function get_error_message(message: unknown): string | null {
	if (!message || typeof message !== 'object') return null;
	const error_message = (message as { errorMessage?: unknown })
		.errorMessage;
	return typeof error_message === 'string' ? error_message : null;
}

export function infer_run_outcome(event: AgentEndEvent): {
	success: boolean | null;
	error_message: string | null;
} {
	const assistant_messages = event.messages.filter(
		(message) => message.role === 'assistant',
	);
	const last_assistant = assistant_messages.at(-1);
	const stop_reason = get_stop_reason(last_assistant);
	if (stop_reason === 'error') {
		return {
			success: false,
			error_message:
				get_error_message(last_assistant) ?? 'agent error',
		};
	}
	if (stop_reason === 'aborted') {
		return {
			success: false,
			error_message:
				get_error_message(last_assistant) ?? 'agent aborted',
		};
	}
	return {
		success: true,
		error_message: null,
	};
}

export function format_telemetry_status(options: {
	saved_enabled: boolean;
	effective_enabled: boolean;
	override?: boolean;
	db_path: string;
}): string {
	const override_label =
		options.override === undefined
			? 'none'
			: options.override
				? '--telemetry'
				: '--no-telemetry';

	return [
		`telemetry ${options.effective_enabled ? 'enabled' : 'disabled'} now`,
		`default ${options.saved_enabled ? 'enabled' : 'disabled'}`,
		`override ${override_label}`,
		`db ${options.db_path}`,
	].join('\n');
}

function format_bytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KiB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function format_timestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

function format_duration(duration_ms: number | null): string {
	if (duration_ms === null) return 'open';
	if (duration_ms < 1000) return `${duration_ms}ms`;
	if (duration_ms < 60_000) {
		return `${(duration_ms / 1000).toFixed(1)}s`;
	}
	return `${(duration_ms / 60_000).toFixed(1)}m`;
}

function format_success(value: boolean | null): string {
	if (value === true) return 'success';
	if (value === false) return 'failure';
	return 'unknown';
}

function tokenize_command_args(input: string): string[] {
	const matches =
		input.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) ?? [];
	return matches.map((token) => {
		if (
			(token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith("'") && token.endsWith("'"))
		) {
			return token.slice(1, -1);
		}
		return token;
	});
}

export interface ParsedTelemetryCommand {
	subcommand: string;
	export_path: string | null;
	filters: TelemetryQueryFilters;
	errors: string[];
}

export function parse_telemetry_command(
	input: string,
): ParsedTelemetryCommand {
	const tokens = tokenize_command_args(input.trim());
	const subcommand = tokens[0] ?? 'status';
	const filters: TelemetryQueryFilters = {};
	let export_path: string | null = null;
	const errors: string[] = [];

	for (const token of tokens.slice(1)) {
		const equals_index = token.indexOf('=');
		if (equals_index === -1) {
			if (subcommand === 'export' && export_path === null) {
				export_path = token;
			} else {
				errors.push(`Unexpected argument: ${token}`);
			}
			continue;
		}

		const key = token.slice(0, equals_index);
		const value = token.slice(equals_index + 1);
		switch (key) {
			case 'eval_run_id':
			case 'run':
				filters.eval_run_id = value;
				break;
			case 'eval_case_id':
			case 'case':
				filters.eval_case_id = value;
				break;
			case 'eval_suite':
			case 'suite':
				filters.eval_suite = value;
				break;
			case 'success':
				if (value === 'true') filters.success = true;
				else if (value === 'false') filters.success = false;
				else if (value === 'null') filters.success = null;
				else {
					errors.push(
						`Invalid success value: ${value}. Use true, false, or null`,
					);
				}
				break;
			case 'limit': {
				const parsed = Number.parseInt(value, 10);
				if (!Number.isFinite(parsed) || parsed <= 0) {
					errors.push(
						`Invalid limit value: ${value}. Use a positive integer`,
					);
				} else {
					filters.limit = parsed;
				}
				break;
			}
			default:
				errors.push(`Unknown filter: ${key}`);
		}
	}

	if (subcommand === 'query' && filters.limit === undefined) {
		filters.limit = DEFAULT_QUERY_LIMIT;
	}

	return {
		subcommand,
		export_path,
		filters,
		errors,
	};
}

function format_filter_summary(
	filters: TelemetryQueryFilters,
): string {
	const parts: string[] = [];
	if (filters.eval_run_id !== undefined) {
		parts.push(`eval_run_id=${filters.eval_run_id}`);
	}
	if (filters.eval_case_id !== undefined) {
		parts.push(`eval_case_id=${filters.eval_case_id}`);
	}
	if (filters.eval_suite !== undefined) {
		parts.push(`eval_suite=${filters.eval_suite}`);
	}
	if (filters.success !== undefined) {
		parts.push(`success=${String(filters.success)}`);
	}
	if (filters.limit !== undefined) {
		parts.push(`limit=${filters.limit}`);
	}
	return parts.length > 0 ? parts.join(' ') : 'none';
}

export function format_telemetry_stats(options: {
	db_path: string;
	stats: TelemetryStats;
}): string {
	return [
		`db ${options.db_path}`,
		`schema v${options.stats.schema_version}`,
		`runs ${options.stats.runs}`,
		`turns ${options.stats.turns}`,
		`tool_calls ${options.stats.tool_calls}`,
		`provider_requests ${options.stats.provider_requests}`,
		`db_bytes ${format_bytes(options.stats.db_bytes)}`,
		`wal_bytes ${format_bytes(options.stats.wal_bytes)}`,
		`total_bytes ${format_bytes(options.stats.total_bytes)}`,
	].join('\n');
}

export function format_telemetry_query_results(options: {
	db_path: string;
	filters: TelemetryQueryFilters;
	runs: TelemetryRunSummary[];
}): string {
	if (options.runs.length === 0) {
		return [
			`db ${options.db_path}`,
			`filters ${format_filter_summary(options.filters)}`,
			'no matching runs',
		].join('\n');
	}

	return [
		`db ${options.db_path}`,
		`filters ${format_filter_summary(options.filters)}`,
		...options.runs.map((run) =>
			[
				`${format_timestamp(run.started_at)} ${run.id}`,
				`status=${format_success(run.success)}`,
				`duration=${format_duration(run.duration_ms)}`,
				`turns=${run.turn_count}`,
				`tools=${run.tool_call_count}`,
				`tool_errors=${run.tool_error_count}`,
				`provider_requests=${run.provider_request_count}`,
				run.eval_run_id ? `eval_run_id=${run.eval_run_id}` : null,
				run.eval_case_id ? `eval_case_id=${run.eval_case_id}` : null,
				run.eval_suite ? `eval_suite=${run.eval_suite}` : null,
			]
				.filter(Boolean)
				.join(' '),
		),
	].join('\n');
}

function get_default_telemetry_export_path(cwd: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return resolve(cwd, `telemetry-export-${stamp}.json`);
}

async function default_load_store(
	db_path: string,
): Promise<TelemetryStore> {
	const { TelemetryDatabase } = await import('./telemetry-db.js');
	return TelemetryDatabase.open(db_path);
}

export function create_telemetry_extension(
	options: CreateTelemetryExtensionOptions = {},
) {
	return async function telemetry(pi: ExtensionAPI) {
		const now = options.now ?? (() => Date.now());
		const load_store = options.load_store ?? default_load_store;
		const cwd = options.cwd ?? process.cwd();
		const db_path = resolve_telemetry_db_path(cwd, options.db_path);
		let config: TelemetryConfig = load_telemetry_config();
		let store: TelemetryStore | null = null;
		let effective_enabled = resolve_telemetry_enabled(
			config,
			options.enabled,
		);
		let current_model = {
			provider: null as string | null,
			id: null as string | null,
		};
		let active_run: ActiveRun | null = null;
		const active_turns = new Map<number, ActiveTurn>();
		const provider_request_ids: string[] = [];

		async function ensure_store(): Promise<TelemetryStore | null> {
			if (!effective_enabled) return null;
			if (!store) {
				store = await load_store(db_path);
			}
			return store;
		}

		function finish_active_run_on_disable(reason: string): void {
			if (!store || !active_run) return;
			store.finish_run({
				id: active_run.id,
				ended_at: now(),
				success: null,
				error_message: reason,
			});
			active_run = null;
			active_turns.clear();
			provider_request_ids.length = 0;
		}

		function close_store(): void {
			if (!store) return;
			store.close();
			store = null;
		}

		function command_message(
			ctx: ExtensionCommandContext,
			message: string,
		): void {
			if (ctx.hasUI) {
				ctx.ui.notify(message);
			} else {
				console.error(message);
			}
		}

		pi.registerCommand('telemetry', {
			description:
				'Manage local SQLite telemetry for evals and debugging',
			getArgumentCompletions: (prefix) => {
				const trimmed = prefix.trim();
				const first_token = trimmed.split(/\s+/, 1)[0] ?? '';
				return COMMANDS.filter((command) =>
					command.startsWith(first_token),
				).map((command) => ({ value: command, label: command }));
			},
			handler: async (args, ctx) => {
				const parsed = parse_telemetry_command(args);
				const subcommand = parsed.subcommand;
				if (!COMMANDS.includes(subcommand)) {
					command_message(
						ctx,
						`Unknown telemetry command: ${subcommand}. Use: ${COMMANDS.join(', ')}`,
					);
					return;
				}
				if (parsed.errors.length > 0) {
					command_message(ctx, parsed.errors.join('\n'));
					return;
				}

				if (subcommand === 'status') {
					command_message(
						ctx,
						format_telemetry_status({
							saved_enabled: config.enabled,
							effective_enabled,
							override: options.enabled,
							db_path,
						}),
					);
					return;
				}

				if (subcommand === 'stats') {
					if (!existsSync(db_path)) {
						command_message(
							ctx,
							`No telemetry database at ${db_path}`,
						);
						return;
					}

					const stats_store = store ?? (await load_store(db_path));
					const should_close_after = stats_store !== store;
					try {
						command_message(
							ctx,
							format_telemetry_stats({
								db_path,
								stats: stats_store.get_stats(),
							}),
						);
					} finally {
						if (should_close_after) {
							stats_store.close();
						}
					}
					return;
				}

				if (subcommand === 'query' || subcommand === 'export') {
					if (!existsSync(db_path)) {
						command_message(
							ctx,
							`No telemetry database at ${db_path}`,
						);
						return;
					}

					const query_store = store ?? (await load_store(db_path));
					const should_close_after = query_store !== store;
					try {
						const runs = query_store.query_runs(parsed.filters);
						if (subcommand === 'query') {
							command_message(
								ctx,
								format_telemetry_query_results({
									db_path,
									filters: parsed.filters,
									runs,
								}),
							);
							return;
						}

						const export_path = resolve(
							cwd,
							parsed.export_path ??
								get_default_telemetry_export_path(cwd),
						);
						mkdirSync(dirname(export_path), { recursive: true });
						writeFileSync(
							export_path,
							JSON.stringify(
								{
									exported_at: new Date().toISOString(),
									db_path,
									schema_version:
										query_store.get_stats().schema_version,
									filters: parsed.filters,
									runs,
								},
								null,
								2,
							),
							'utf-8',
						);
						command_message(
							ctx,
							`Exported ${runs.length} telemetry run${runs.length === 1 ? '' : 's'} to ${export_path}`,
						);
						return;
					} finally {
						if (should_close_after) {
							query_store.close();
						}
					}
				}

				if (subcommand === 'path') {
					command_message(ctx, db_path);
					return;
				}

				const next_enabled = subcommand === 'on';
				config = { ...config, enabled: next_enabled };
				save_telemetry_config(config);

				if (options.enabled !== undefined) {
					command_message(
						ctx,
						[
							`Saved default telemetry ${next_enabled ? 'enabled' : 'disabled'}.`,
							`Current process still uses ${options.enabled ? '--telemetry' : '--no-telemetry'}.`,
						].join(' '),
					);
					return;
				}

				effective_enabled = next_enabled;
				if (effective_enabled) {
					await ensure_store();
					command_message(
						ctx,
						`Telemetry enabled. Writing to ${db_path}`,
					);
					return;
				}

				finish_active_run_on_disable('telemetry disabled');
				close_store();
				command_message(ctx, 'Telemetry disabled.');
			},
		});

		pi.on('model_select', async (event) => {
			current_model = get_model_identity(event.model);
		});

		pi.on('agent_start', async (_event, ctx) => {
			const active_store = await ensure_store();
			if (!active_store) return;

			const run_id = randomUUID();
			const eval_metadata = get_eval_metadata();
			const model_identity = ctx.model
				? get_model_identity(ctx.model)
				: current_model;
			active_store.insert_run({
				id: run_id,
				session_file: get_session_file(ctx),
				cwd: ctx.cwd,
				started_at: now(),
				model_provider: model_identity.provider,
				model_id: model_identity.id,
				eval_run_id: eval_metadata.run_id,
				eval_case_id: eval_metadata.case_id,
				eval_attempt: eval_metadata.attempt,
				eval_suite: eval_metadata.suite,
			});
			active_run = {
				id: run_id,
			};
			active_turns.clear();
			provider_request_ids.length = 0;
		});

		pi.on('agent_end', async (event) => {
			if (!store || !active_run) return;
			const outcome = infer_run_outcome(event);
			store.finish_run({
				id: active_run.id,
				ended_at: now(),
				success: outcome.success,
				error_message: outcome.error_message,
			});
			active_run = null;
			active_turns.clear();
			provider_request_ids.length = 0;
		});

		pi.on('turn_start', async (event) => {
			if (!store || !active_run) return;
			const turn_id = `${active_run.id}:turn:${event.turnIndex}`;
			active_turns.set(event.turnIndex, {
				id: turn_id,
			});
			store.insert_turn({
				id: turn_id,
				run_id: active_run.id,
				turn_index: event.turnIndex,
				started_at: event.timestamp,
			});
		});

		pi.on('turn_end', async (event) => {
			const active_turn = active_turns.get(event.turnIndex);
			if (!store || !active_turn) return;
			store.finish_turn({
				id: active_turn.id,
				ended_at: now(),
				tool_result_count: event.toolResults.length,
				stop_reason: get_stop_reason(event.message),
			});
			active_turns.delete(event.turnIndex);
		});

		pi.on('tool_execution_start', async (event) => {
			if (!store || !active_run) return;
			const current_turn = [...active_turns.values()].at(-1);
			store.insert_tool_call({
				tool_call_id: event.toolCallId,
				run_id: active_run.id,
				turn_id: current_turn?.id ?? null,
				tool_name: event.toolName,
				started_at: now(),
				args_summary_json: summarize_tool_args(
					event.toolName,
					event.args,
				),
			});
		});

		pi.on('tool_execution_update', async (event) => {
			if (!store || !active_run) return;
			store.note_tool_update(event.toolCallId);
		});

		pi.on('tool_execution_end', async (event) => {
			if (!store || !active_run) return;
			store.finish_tool_call({
				tool_call_id: event.toolCallId,
				ended_at: now(),
				is_error: event.isError,
				result_summary_json: summarize_tool_result(event.result),
				error_message:
					event.isError && event.result != null
						? safe_json_stringify(summarize_value(event.result))
						: null,
			});
		});

		pi.on('before_provider_request', async (event) => {
			if (!store || !active_run) return;
			const request_id = randomUUID();
			const current_turn = [...active_turns.values()].at(-1);
			store.insert_provider_request({
				id: request_id,
				run_id: active_run.id,
				turn_id: current_turn?.id ?? null,
				started_at: now(),
				payload_summary_json: summarize_provider_payload(
					event.payload,
				),
			});
			provider_request_ids.push(request_id);
		});

		pi.on('after_provider_response', async (event) => {
			if (!store || !active_run) return;
			const request_id = provider_request_ids.shift();
			if (!request_id) return;
			store.finish_provider_request({
				id: request_id,
				ended_at: now(),
				status_code: event.status,
				headers_json: summarize_headers(event.headers),
			});
		});

		pi.on('session_shutdown', async () => {
			if (store && active_run) {
				store.finish_run({
					id: active_run.id,
					ended_at: now(),
					success: null,
					error_message: 'session shutdown',
				});
			}
			close_store();
			active_run = null;
			active_turns.clear();
			provider_request_ids.length = 0;
		});
	};
}

export default create_telemetry_extension();
