import type { ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { as_record } from './config.js';
import { create_child_process_env } from './env.js';
import type { CommandRunResult, HookEventName } from './types.js';

const HOOK_TIMEOUT_MS = 10 * 60 * 1000;

export async function run_command_hook(
	command: string,
	cwd: string,
	payload: Record<string, unknown>,
	pi_session_env: Record<string, string> = {},
): Promise<CommandRunResult> {
	return await new Promise((resolve) => {
		const started_at = Date.now();
		const child = spawn('bash', ['-lc', command], {
			cwd,
			env: create_child_process_env({
				CLAUDE_PROJECT_DIR: cwd,
				...pi_session_env,
			}),
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

export function hook_block_reason(
	result: CommandRunResult,
): string | undefined {
	const parse_json = (
		text: string,
	): Record<string, unknown> | undefined => {
		const trimmed = text.trim();
		if (!trimmed) return undefined;
		try {
			return as_record(JSON.parse(trimmed));
		} catch {
			return undefined;
		}
	};

	const json = parse_json(result.stdout) ?? parse_json(result.stderr);
	if (json?.decision === 'block') {
		return typeof json.reason === 'string'
			? json.reason
			: 'Blocked by hook';
	}
	if (result.code === 2) {
		return (
			result.stderr.trim() ||
			result.stdout.trim() ||
			'Blocked by hook'
		);
	}
	return undefined;
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
