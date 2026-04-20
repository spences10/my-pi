// Hooks resolution — Claude Code style hook compatibility

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolResultEvent,
} from '@mariozechner/pi-coding-agent';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const HOOK_TIMEOUT_MS = 10 * 60 * 1000;

type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type HookEventName = 'PostToolUse' | 'PostToolUseFailure';

export interface ResolvedCommandHook {
	event_name: HookEventName;
	matcher?: RegExp;
	matcher_text?: string;
	command: string;
	source: string;
}

export interface HookState {
	project_dir: string;
	hooks: ResolvedCommandHook[];
}

export interface CommandRunResult {
	code: number;
	stdout: string;
	stderr: string;
	elapsed_ms: number;
	timed_out: boolean;
}

export function is_file(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function as_record(
	value: unknown,
): Record<string, unknown> | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	return value as Record<string, unknown>;
}

export function walk_up_directories(
	start_dir: string,
	stop_dir?: string,
): string[] {
	const directories: string[] = [];
	const has_stop_dir = stop_dir !== undefined;
	let current = resolve(start_dir);
	let parent = dirname(current);
	let reached_stop_dir = has_stop_dir && current === stop_dir;
	let reached_filesystem_root = parent === current;

	directories.push(current);
	while (!reached_stop_dir && !reached_filesystem_root) {
		current = parent;
		parent = dirname(current);
		reached_stop_dir = has_stop_dir && current === stop_dir;
		reached_filesystem_root = parent === current;
		directories.push(current);
	}

	return directories;
}

export function find_nearest_git_root(
	start_dir: string,
): string | undefined {
	for (const directory of walk_up_directories(start_dir)) {
		if (existsSync(join(directory, '.git'))) {
			return directory;
		}
	}
	return undefined;
}

export function has_hooks_config(directory: string): boolean {
	return (
		is_file(join(directory, '.claude', 'settings.json')) ||
		is_file(join(directory, '.rulesync', 'hooks.json')) ||
		is_file(join(directory, '.pi', 'hooks.json'))
	);
}

export function find_project_dir(cwd: string): string {
	const git_root = find_nearest_git_root(cwd);
	for (const directory of walk_up_directories(cwd, git_root)) {
		if (has_hooks_config(directory)) {
			return directory;
		}
	}
	return git_root ?? resolve(cwd);
}

export function read_json_file(path: string): JsonValue | undefined {
	if (!is_file(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
	} catch {
		return undefined;
	}
}

export function resolve_hook_command(
	command: string,
	project_dir: string,
): string {
	return command.replace(/\$CLAUDE_PROJECT_DIR\b/g, project_dir);
}

export function compile_matcher(
	matcher_text: string | undefined,
): RegExp | undefined {
	if (matcher_text === undefined) return undefined;
	try {
		return new RegExp(matcher_text);
	} catch {
		return undefined;
	}
}

export function create_hook(
	event_name: HookEventName,
	matcher_text: string | undefined,
	command: string,
	source: string,
	project_dir: string,
): ResolvedCommandHook | undefined {
	const matcher = compile_matcher(matcher_text);
	if (matcher_text !== undefined && matcher === undefined)
		return undefined;
	return {
		event_name,
		matcher,
		matcher_text,
		command: resolve_hook_command(command, project_dir),
		source,
	};
}

export function get_hook_entries(
	hooks_record: Record<string, unknown>,
	event_name: HookEventName,
): unknown[] {
	const keys =
		event_name === 'PostToolUse'
			? ['PostToolUse', 'postToolUse']
			: ['PostToolUseFailure', 'postToolUseFailure'];

	for (const key of keys) {
		const value = hooks_record[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}

export function parse_claude_settings_hooks(
	config: unknown,
	source: string,
	project_dir: string,
): ResolvedCommandHook[] {
	const root = as_record(config);
	const hooks_root = root ? as_record(root.hooks) : undefined;
	if (!hooks_root) return [];

	const hooks: ResolvedCommandHook[] = [];
	const events: HookEventName[] = [
		'PostToolUse',
		'PostToolUseFailure',
	];

	for (const event_name of events) {
		const entries = get_hook_entries(hooks_root, event_name);
		for (const entry of entries) {
			const entry_record = as_record(entry);
			if (!entry_record || !Array.isArray(entry_record.hooks))
				continue;

			const matcher_text =
				typeof entry_record.matcher === 'string'
					? entry_record.matcher
					: undefined;
			for (const nested_hook of entry_record.hooks) {
				const nested_record = as_record(nested_hook);
				if (!nested_record) continue;
				if (nested_record.type !== 'command') continue;
				if (typeof nested_record.command !== 'string') continue;

				const hook = create_hook(
					event_name,
					matcher_text,
					nested_record.command,
					source,
					project_dir,
				);
				if (hook) hooks.push(hook);
			}
		}
	}

	return hooks;
}

export function parse_simple_hooks_file(
	config: unknown,
	source: string,
	project_dir: string,
): ResolvedCommandHook[] {
	const root = as_record(config);
	const hooks_root = root ? as_record(root.hooks) : undefined;
	if (!hooks_root) return [];

	const hooks: ResolvedCommandHook[] = [];
	const events: HookEventName[] = [
		'PostToolUse',
		'PostToolUseFailure',
	];

	for (const event_name of events) {
		const entries = get_hook_entries(hooks_root, event_name);
		for (const entry of entries) {
			const entry_record = as_record(entry);
			if (!entry_record || typeof entry_record.command !== 'string') {
				continue;
			}

			const matcher_text =
				typeof entry_record.matcher === 'string'
					? entry_record.matcher
					: undefined;
			const hook = create_hook(
				event_name,
				matcher_text,
				entry_record.command,
				source,
				project_dir,
			);
			if (hook) hooks.push(hook);
		}
	}

	return hooks;
}

export function load_hooks(cwd: string): HookState {
	const project_dir = find_project_dir(cwd);
	const hooks: ResolvedCommandHook[] = [];

	const claude_settings_path = join(
		project_dir,
		'.claude',
		'settings.json',
	);
	const rulesync_hooks_path = join(
		project_dir,
		'.rulesync',
		'hooks.json',
	);
	const pi_hooks_path = join(project_dir, '.pi', 'hooks.json');

	const claude_settings = read_json_file(claude_settings_path);
	if (claude_settings !== undefined) {
		hooks.push(
			...parse_claude_settings_hooks(
				claude_settings,
				claude_settings_path,
				project_dir,
			),
		);
	}

	const rulesync_hooks = read_json_file(rulesync_hooks_path);
	if (rulesync_hooks !== undefined) {
		hooks.push(
			...parse_simple_hooks_file(
				rulesync_hooks,
				rulesync_hooks_path,
				project_dir,
			),
		);
	}

	const pi_hooks = read_json_file(pi_hooks_path);
	if (pi_hooks !== undefined) {
		hooks.push(
			...parse_simple_hooks_file(
				pi_hooks,
				pi_hooks_path,
				project_dir,
			),
		);
	}

	return { project_dir, hooks };
}

export function to_claude_tool_name(tool_name: string): string {
	if (tool_name === 'ls') return 'LS';
	if (tool_name.length === 0) return tool_name;
	return tool_name[0].toUpperCase() + tool_name.slice(1);
}

export function matches_hook(
	hook: ResolvedCommandHook,
	tool_name: string,
): boolean {
	if (!hook.matcher) return true;

	const claude_tool_name = to_claude_tool_name(tool_name);
	hook.matcher.lastIndex = 0;
	if (hook.matcher.test(tool_name)) return true;

	hook.matcher.lastIndex = 0;
	return hook.matcher.test(claude_tool_name);
}

export function extract_text_content(content: unknown): string {
	if (!Array.isArray(content)) return '';

	const parts: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== 'object') continue;
		const item_record = item as Record<string, unknown>;
		if (
			item_record.type === 'text' &&
			typeof item_record.text === 'string'
		) {
			parts.push(item_record.text);
		}
	}

	return parts.join('\n');
}

export function normalize_tool_input(
	input: Record<string, unknown>,
): Record<string, unknown> {
	const normalized: Record<string, unknown> = { ...input };
	const path_value =
		typeof input.path === 'string' ? input.path : undefined;
	if (path_value !== undefined) {
		normalized.file_path = path_value;
		normalized.filePath = path_value;
	}
	return normalized;
}

export function build_tool_response(
	event: ToolResultEvent,
	normalized_input: Record<string, unknown>,
): Record<string, unknown> {
	const response: Record<string, unknown> = {
		is_error: event.isError,
		isError: event.isError,
		content: event.content,
		text: extract_text_content(event.content),
		details: event.details ?? null,
	};

	const file_path =
		typeof normalized_input.file_path === 'string'
			? normalized_input.file_path
			: undefined;
	if (file_path !== undefined) {
		response.file_path = file_path;
		response.filePath = file_path;
	}

	return response;
}

export function build_hook_payload(
	event: ToolResultEvent,
	event_name: HookEventName,
	ctx: ExtensionContext,
	project_dir: string,
): Record<string, unknown> {
	const normalized_input = normalize_tool_input(
		event.input as Record<string, unknown>,
	);
	const session_id =
		ctx.sessionManager.getSessionFile() ?? 'ephemeral';

	return {
		session_id,
		cwd: ctx.cwd,
		claude_project_dir: project_dir,
		hook_event_name: event_name,
		tool_name: to_claude_tool_name(event.toolName),
		tool_call_id: event.toolCallId,
		tool_input: normalized_input,
		tool_response: build_tool_response(event, normalized_input),
	};
}

export async function run_command_hook(
	command: string,
	cwd: string,
	payload: Record<string, unknown>,
): Promise<CommandRunResult> {
	return await new Promise((resolve) => {
		const started_at = Date.now();
		const child = spawn('bash', ['-lc', command], {
			cwd,
			env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let timed_out = false;
		let resolved = false;

		const finish = (code: number) => {
			if (resolved) return;
			resolved = true;
			resolve({
				code,
				stdout,
				stderr,
				elapsed_ms: Date.now() - started_at,
				timed_out,
			});
		};

		const timeout = setTimeout(() => {
			timed_out = true;
			child.kill('SIGTERM');
			const kill_timer = setTimeout(() => {
				child.kill('SIGKILL');
			}, 1000);
			(
				kill_timer as NodeJS.Timeout & { unref?: () => void }
			).unref?.();
		}, HOOK_TIMEOUT_MS);
		(timeout as NodeJS.Timeout & { unref?: () => void }).unref?.();

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});

		child.on('error', (error) => {
			clearTimeout(timeout);
			stderr += `${error.message}\n`;
			finish(-1);
		});

		child.on('close', (code) => {
			clearTimeout(timeout);
			finish(code ?? -1);
		});

		try {
			child.stdin.write(JSON.stringify(payload));
			child.stdin.end();
		} catch (error) {
			stderr += `${error instanceof Error ? error.message : String(error)}\n`;
		}
	});
}

export function hook_event_name_for_result(
	event: ToolResultEvent,
): HookEventName {
	return event.isError ? 'PostToolUseFailure' : 'PostToolUse';
}

export function format_duration(elapsed_ms: number): string {
	if (elapsed_ms < 1000) return `${elapsed_ms}ms`;
	return `${(elapsed_ms / 1000).toFixed(1)}s`;
}

export function hook_name(command: string): string {
	const sh_path_match = command.match(/[^\s|;&]+\.sh\b/);
	if (sh_path_match) return basename(sh_path_match[0]);
	const first_token = command.trim().split(/\s+/)[0] ?? 'hook';
	return basename(first_token);
}

export interface HooksResolutionOptions {
	load_hooks?: (cwd: string) => HookState;
	run_command_hook?: (
		command: string,
		cwd: string,
		payload: Record<string, unknown>,
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

		const refresh_hooks = (cwd: string) => {
			state = load_hooks_impl(cwd);
		};

		pi.on('session_start', (_event, ctx) => {
			refresh_hooks(ctx.cwd);
		});

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
