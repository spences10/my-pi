// Confirm destructive tool calls before they run.

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	UserBashEvent,
	UserBashEventResult,
} from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	assess_bash_command,
	assess_tool_call,
} from './destructive/assessors.js';
import {
	command_may_create_temp_path,
	extract_bash_create_paths,
	extract_created_temp_paths_from_result,
} from './destructive/shell.js';
import type { DestructiveAction } from './destructive/types.js';

export type { DestructiveAction } from './destructive/types.js';

export { assess_bash_command, assess_tool_call };

type ConfirmDecision = 'allow' | 'allow-similar' | 'block';

async function confirm_action(
	action: DestructiveAction,
	ctx: ExtensionContext,
): Promise<ConfirmDecision> {
	if (!ctx.hasUI) return 'block';

	const choice = await ctx.ui.select(
		`${action.title}\n${action.description}`,
		['Allow once', 'Allow similar for this session', 'Block'],
	);

	if (choice === 'Allow once') return 'allow';

	if (choice === 'Allow similar for this session') {
		return 'allow-similar';
	}

	ctx.ui.notify('Destructive action blocked', 'info');

	return 'block';
}

function blocked_reason(action: DestructiveAction): string {
	return `Blocked destructive action: ${action.reason}`;
}

function blocked_bash_result(action: DestructiveAction) {
	return {
		output: `${blocked_reason(action)}\n`,
		exitCode: 130,
		cancelled: false,
		truncated: false,
	};
}

export default async function confirm_destructive(pi: ExtensionAPI) {
	const allowed_for_session = new Set<string>();
	const pending_created_files = new Map<string, string>();
	const pending_bash_created_paths = new Map<string, string[]>();
	const bash_may_create_temp_path = new Set<string>();
	const session_created_files = new Set<string>();

	function is_allowed(action: DestructiveAction): boolean {
		return allowed_for_session.has(action.allow_key);
	}

	async function should_allow(
		action: DestructiveAction,
		ctx: ExtensionContext,
	): Promise<boolean> {
		if (is_allowed(action)) return true;

		const decision = await confirm_action(action, ctx);

		if (decision === 'allow-similar') {
			allowed_for_session.add(action.allow_key);

			return true;
		}

		return decision === 'allow';
	}

	pi.on(
		'tool_call',
		async (
			event: ToolCallEvent,
			ctx,
		): Promise<ToolCallEventResult | void> => {
			if (event.toolName === 'write') {
				const path = event.input.path;

				if (typeof path === 'string' && path.trim()) {
					const absolute = resolve(ctx.cwd, path);

					if (!existsSync(absolute)) {
						pending_created_files.set(event.toolCallId, absolute);
					}
				}
			}

			if (event.toolName === 'bash') {
				const command = event.input.command;

				if (typeof command === 'string') {
					const paths = extract_bash_create_paths(command, ctx.cwd);

					if (paths.length > 0) {
						pending_bash_created_paths.set(event.toolCallId, paths);
					}

					if (command_may_create_temp_path(command)) {
						bash_may_create_temp_path.add(event.toolCallId);
					}
				}
			}

			const action = assess_tool_call(
				event,
				ctx.cwd,
				session_created_files,
			);

			if (!action) return;

			if (await should_allow(action, ctx)) return;

			return {
				block: true,
				reason: blocked_reason(action),
			};
		},
	);

	pi.on(
		'tool_result',
		async (event: ToolResultEvent): Promise<void> => {
			const absolute = pending_created_files.get(event.toolCallId);

			if (absolute) {
				pending_created_files.delete(event.toolCallId);

				if (event.toolName === 'write' && !event.isError) {
					session_created_files.add(absolute);
				}
			}

			const bash_paths = pending_bash_created_paths.get(
				event.toolCallId,
			);

			if (bash_paths) {
				pending_bash_created_paths.delete(event.toolCallId);

				if (event.toolName === 'bash' && !event.isError) {
					for (const path of bash_paths) {
						if (existsSync(path)) session_created_files.add(path);
					}
				}
			}

			if (bash_may_create_temp_path.has(event.toolCallId)) {
				bash_may_create_temp_path.delete(event.toolCallId);

				if (event.toolName === 'bash' && !event.isError) {
					for (const path of extract_created_temp_paths_from_result(
						event,
					)) {
						session_created_files.add(path);
					}
				}
			}
		},
	);

	pi.on(
		'user_bash',
		async (
			event: UserBashEvent,
			ctx,
		): Promise<UserBashEventResult | void> => {
			const action = assess_bash_command(
				event.command,
				event.cwd,
				session_created_files,
			);

			if (!action) return;

			if (await should_allow(action, ctx)) return;

			return { result: blocked_bash_result(action) };
		},
	);
}
