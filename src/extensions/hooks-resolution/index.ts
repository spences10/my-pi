// Hooks resolution — Claude Code style hook compatibility

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import { load_hooks } from './config.js';
import { create_hook_session_env } from './env.js';
import { build_hook_payload, matches_hook } from './payload.js';
import {
	format_duration,
	hook_block_reason,
	hook_event_name_for_result,
	hook_name,
	run_command_hook,
} from './runner.js';
import { should_load_hooks_config } from './trust-gate.js';
import type { CommandRunResult, HookState } from './types.js';

export {
	as_record,
	compile_matcher,
	create_hook,
	find_nearest_git_root,
	find_project_dir,
	get_hook_entries,
	get_hooks_config_info,
	has_hooks_config,
	is_file,
	load_hooks,
	parse_claude_settings_hooks,
	parse_simple_hooks_file,
	read_json_file,
	resolve_hook_command,
	walk_up_directories,
} from './config.js';
export {
	build_hook_payload,
	build_tool_response,
	extract_text_content,
	matches_hook,
	normalize_tool_input,
	to_claude_tool_name,
} from './payload.js';
export {
	format_duration,
	hook_block_reason,
	hook_event_name_for_result,
	hook_name,
	run_command_hook,
} from './runner.js';
export type {
	CommandRunResult,
	HookEventName,
	HooksConfigInfo,
	HookState,
	ResolvedCommandHook,
} from './types.js';
export interface HooksResolutionOptions {
	load_hooks?: (cwd: string) => HookState;
	run_command_hook?: (
		command: string,
		cwd: string,
		payload: Record<string, unknown>,
		pi_session_env?: Record<string, string>,
	) => Promise<CommandRunResult>;
}

export function create_hooks_resolution_extension(
	options: HooksResolutionOptions = {},
): ExtensionFactory {
	const load_hooks_impl = options.load_hooks ?? load_hooks;
	const run_command_hook_impl =
		options.run_command_hook ?? run_command_hook;

	return async function hooks_resolution(pi: ExtensionAPI) {
		let state: HookState = {
			project_dir: process.cwd(),
			hooks: [],
		};

		const refresh_hooks = async (
			cwd: string,
			ctx?: ExtensionContext,
		) => {
			if (!(await should_load_hooks_config(cwd, ctx))) {
				state = { project_dir: cwd, hooks: [] };
				return;
			}
			state = load_hooks_impl(cwd);
		};

		pi.on('session_start', async (_event, ctx) => {
			await refresh_hooks(ctx.cwd, ctx);
		});

		pi.on(
			'tool_call',
			async (
				event,
				ctx,
			): Promise<ToolCallEventResult | undefined> => {
				if (state.hooks.length === 0) return;

				const matching_hooks = state.hooks.filter(
					(hook) =>
						hook.event_name === 'PreToolUse' &&
						matches_hook(hook, event.toolName),
				);
				if (matching_hooks.length === 0) return;

				const payload = build_hook_payload(
					event,
					'PreToolUse',
					ctx,
					state.project_dir,
				);
				const executed_commands = new Set<string>();

				for (const hook of matching_hooks) {
					if (executed_commands.has(hook.command)) continue;
					executed_commands.add(hook.command);

					const result = await run_command_hook_impl(
						hook.command,
						state.project_dir,
						payload,
						create_hook_session_env(ctx),
					);
					const reason = hook_block_reason(result);
					if (reason) return { block: true, reason };
				}
			},
		);

		pi.on('tool_result', async (event, ctx) => {
			if (state.hooks.length === 0) return;

			const event_name = hook_event_name_for_result(event);
			const matching_hooks = state.hooks.filter(
				(hook) =>
					hook.event_name === event_name &&
					matches_hook(hook, event.toolName),
			);
			if (matching_hooks.length === 0) return;

			const payload = build_hook_payload(
				event,
				event_name,
				ctx,
				state.project_dir,
			);
			const executed_commands = new Set<string>();

			for (const hook of matching_hooks) {
				if (executed_commands.has(hook.command)) continue;
				executed_commands.add(hook.command);

				const result = await run_command_hook_impl(
					hook.command,
					state.project_dir,
					payload,
					create_hook_session_env(ctx),
				);
				const name = hook_name(hook.command);
				const duration = format_duration(result.elapsed_ms);

				if (ctx.hasUI) {
					if (result.code === 0) {
						ctx.ui.notify(
							`Hook \`${name}\` ran (${duration})`,
							'info',
						);
					} else {
						const error_line =
							result.stderr.trim() ||
							result.stdout.trim() ||
							`exit code ${result.code}`;
						ctx.ui.notify(
							`Hook \`${name}\` failed (${duration}): ${error_line}`,
							'warning',
						);
					}
				}
			}
		});
	};
}

export default create_hooks_resolution_extension();
