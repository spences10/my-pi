import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionShutdownEvent,
} from '@mariozechner/pi-coding-agent';
import {
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	COMMANDS,
	DEFAULT_QUERY_LIMIT,
	format_telemetry_query_results,
	format_telemetry_stats,
	format_telemetry_status,
	parse_telemetry_command,
} from './commands.js';
import {
	load_telemetry_config,
	resolve_telemetry_db_path,
	resolve_telemetry_enabled,
	save_telemetry_config,
	type TelemetryConfig,
} from './config.js';
import type {
	TelemetryDatabase,
	TelemetryQueryFilters,
} from './db.js';
import {
	safe_json_stringify,
	summarize_headers,
	summarize_provider_payload,
	summarize_tool_args,
	summarize_tool_result,
	summarize_value,
} from './summaries.js';
export {
	format_telemetry_query_results,
	format_telemetry_stats,
	format_telemetry_status,
	parse_telemetry_command,
	type ParsedTelemetryCommand,
} from './commands.js';

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

export function describe_session_shutdown(
	event: Pick<SessionShutdownEvent, 'reason' | 'targetSessionFile'>,
): string {
	const base = `session shutdown (${event.reason})`;
	return event.targetSessionFile
		? `${base} → ${event.targetSessionFile}`
		: base;
}

function get_default_telemetry_export_path(cwd: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return resolve(cwd, `telemetry-export-${stamp}.json`);
}

async function default_load_store(
	db_path: string,
): Promise<TelemetryStore> {
	const { TelemetryDatabase } = await import('./db.js');
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

		function has_modal_ui(ctx: ExtensionCommandContext): boolean {
			return ctx.hasUI && typeof ctx.ui.custom === 'function';
		}

		async function show_telemetry_text_modal(
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

		async function show_telemetry_home_modal(
			ctx: ExtensionCommandContext,
		): Promise<string | undefined> {
			return await show_picker_modal(ctx, {
				title: 'Telemetry',
				subtitle: `${effective_enabled ? 'enabled' : 'disabled'} • ${db_path}`,
				items: [
					{
						value: 'status',
						label: 'Status',
						description:
							'Effective state, saved default, override, and database path',
					},
					{
						value: 'stats',
						label: 'Stats',
						description:
							'Aggregate runs, turns, tools, and database size',
					},
					{
						value: 'query',
						label: 'Query runs',
						description: `Latest ${DEFAULT_QUERY_LIMIT} runs`,
					},
					{
						value: 'export',
						label: 'Export runs',
						description: 'Write latest matching runs to JSON',
					},
					{
						value: 'on',
						label: 'Enable',
						description: 'Save telemetry enabled as default',
					},
					{
						value: 'off',
						label: 'Disable',
						description: 'Save telemetry disabled as default',
					},
				],
				footer: 'enter runs action • esc close/back',
			});
		}

		async function open_readonly_store(
			ctx: ExtensionCommandContext,
		): Promise<{
			active_store: TelemetryStore;
			should_close_after: boolean;
		} | null> {
			if (!existsSync(db_path)) {
				await show_telemetry_text_modal(
					ctx,
					'Telemetry',
					`No telemetry database at ${db_path}`,
				);
				return null;
			}
			const active_store = store ?? (await load_store(db_path));
			return {
				active_store,
				should_close_after: active_store !== store,
			};
		}

		async function handle_telemetry_home_action(
			ctx: ExtensionCommandContext,
			action: string,
		): Promise<void> {
			if (action === 'status') {
				await show_telemetry_text_modal(
					ctx,
					'Telemetry status',
					format_telemetry_status({
						saved_enabled: config.enabled,
						effective_enabled,
						override: options.enabled,
						db_path,
					}),
				);
				return;
			}

			if (action === 'stats') {
				const opened = await open_readonly_store(ctx);
				if (!opened) return;
				try {
					await show_telemetry_text_modal(
						ctx,
						'Telemetry stats',
						format_telemetry_stats({
							db_path,
							stats: opened.active_store.get_stats(),
						}),
					);
				} finally {
					if (opened.should_close_after) opened.active_store.close();
				}
				return;
			}

			if (action === 'query' || action === 'export') {
				const opened = await open_readonly_store(ctx);
				if (!opened) return;
				try {
					const filters: TelemetryQueryFilters = {
						limit: DEFAULT_QUERY_LIMIT,
					};
					const runs = opened.active_store.query_runs(filters);
					if (action === 'query') {
						await show_telemetry_text_modal(
							ctx,
							'Telemetry runs',
							format_telemetry_query_results({
								db_path,
								filters,
								runs,
							}),
						);
						return;
					}

					const export_path = get_default_telemetry_export_path(cwd);
					const confirmed = await ctx.ui.confirm(
						'Export telemetry runs?',
						`Write ${runs.length} run${runs.length === 1 ? '' : 's'} to ${export_path}`,
					);
					if (!confirmed) return;
					mkdirSync(dirname(export_path), { recursive: true });
					writeFileSync(
						export_path,
						JSON.stringify(
							{
								exported_at: new Date().toISOString(),
								db_path,
								schema_version:
									opened.active_store.get_stats().schema_version,
								filters,
								runs,
							},
							null,
							2,
						),
						'utf-8',
					);
					ctx.ui.notify(
						`Exported ${runs.length} telemetry run${runs.length === 1 ? '' : 's'} to ${export_path}`,
						'info',
					);
				} finally {
					if (opened.should_close_after) opened.active_store.close();
				}
				return;
			}

			const next_enabled = action === 'on';
			const confirmed = await ctx.ui.confirm(
				`${next_enabled ? 'Enable' : 'Disable'} telemetry?`,
				`Save telemetry ${next_enabled ? 'enabled' : 'disabled'} as the default for future sessions.`,
			);
			if (!confirmed) return;
			config = { ...config, enabled: next_enabled };
			save_telemetry_config(config);
			if (options.enabled !== undefined) {
				ctx.ui.notify(
					[
						`Saved default telemetry ${next_enabled ? 'enabled' : 'disabled'}.`,
						`Current process still uses ${options.enabled ? '--telemetry' : '--no-telemetry'}.`,
					].join(' '),
					'info',
				);
				return;
			}
			effective_enabled = next_enabled;
			if (effective_enabled) {
				await ensure_store();
				ctx.ui.notify(
					`Telemetry enabled. Writing to ${db_path}`,
					'info',
				);
				return;
			}
			finish_active_run_on_disable('telemetry disabled');
			close_store();
			ctx.ui.notify('Telemetry disabled.', 'info');
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
				if (!args.trim() && has_modal_ui(ctx)) {
					while (true) {
						const selected = await show_telemetry_home_modal(ctx);
						if (!selected) return;
						await handle_telemetry_home_action(ctx, selected);
					}
				}

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

		pi.on('session_shutdown', async (event) => {
			if (store && active_run) {
				store.finish_run({
					id: active_run.id,
					ended_at: now(),
					success: null,
					error_message: describe_session_shutdown(event),
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
