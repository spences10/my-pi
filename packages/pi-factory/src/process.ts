import { create_child_process_env } from '@spences10/pi-child-env';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandRunner, ProcessRunner } from './types.js';

const MAX_OUTPUT = 64_000;
const AUTH_ENV_KEYS = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_OAUTH_TOKEN',
	'OPENAI_API_KEY',
	'GOOGLE_API_KEY',
	'GEMINI_API_KEY',
	'GITHUB_TOKEN',
	'GH_TOKEN',
	'AZURE_OPENAI_API_KEY',
	'AZURE_OPENAI_BASE_URL',
	'AZURE_OPENAI_RESOURCE_NAME',
] as const;
const active_process_groups = new Set<number>();
const active_descendants = new Map<number, Set<number>>();

function process_exists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function linux_children(pid: number): number[] {
	if (process.platform !== 'linux') return [];
	try {
		return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map(Number)
			.filter(Number.isInteger);
	} catch {
		return [];
	}
}

process.once('exit', () => {
	for (const pid of active_process_groups) {
		try {
			if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
			else process.kill(pid, 'SIGKILL');
		} catch {}
		for (const descendant of active_descendants.get(pid) ?? []) {
			try {
				process.kill(descendant, 'SIGKILL');
			} catch {}
		}
	}
});

function bounded(value: string): string {
	return value.length <= MAX_OUTPUT
		? value
		: `[truncated ${value.length - MAX_OUTPUT} bytes]\n${value.slice(-MAX_OUTPUT)}`;
}

interface ChildResult {
	code: number | null;
	stdout: string;
	stderr: string;
	event: 'exit' | 'error' | 'timeout' | 'abort' | 'lost';
	cleanup: { complete: boolean; residuals: string[] };
}

export function run_child(
	command: string,
	args: string[],
	options: {
		cwd: string;
		signal?: AbortSignal;
		timeout_ms?: number;
		env?: NodeJS.ProcessEnv;
	},
): Promise<ChildResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env:
				options.env ??
				create_child_process_env({
					extra_allowed_keys: AUTH_ENV_KEYS,
				}),
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: process.platform !== 'win32',
		});
		if (child.pid) active_process_groups.add(child.pid);
		const descendants = new Set<number>();
		if (child.pid) active_descendants.set(child.pid, descendants);
		const descendant_timer =
			child.pid && process.platform === 'linux'
				? setInterval(() => {
						const pending = [child.pid!];
						while (pending.length) {
							for (const pid of linux_children(pending.pop()!)) {
								if (descendants.has(pid)) continue;
								descendants.add(pid);
								pending.push(pid);
							}
						}
					}, 1)
				: undefined;
		let stdout = '';
		let stderr = '';
		let settled = false;
		let terminal_event: ChildResult['event'] | undefined;
		let leader_exit_code: number | null = null;
		child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
		child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
		const signal_group = (signal: NodeJS.Signals) => {
			try {
				if (process.platform !== 'win32' && child.pid)
					process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {}
			for (const descendant of descendants) {
				try {
					process.kill(descendant, signal);
				} catch {}
			}
		};
		const group_exists = () => {
			if (process.platform === 'win32' || !child.pid) return false;
			try {
				process.kill(-child.pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		const finish = (
			event: ChildResult['event'],
			code: number | null,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(kill_timer);
			if (descendant_timer) clearInterval(descendant_timer);
			if (child.pid) {
				active_process_groups.delete(child.pid);
				active_descendants.delete(child.pid);
			}
			options.signal?.removeEventListener('abort', abort);
			const residuals = [
				...(group_exists() && child.pid
					? [`process-group:${child.pid}`]
					: []),
				...[...descendants]
					.filter(process_exists)
					.map((pid) => `process:${pid}`),
			];
			resolve({
				code,
				stdout: bounded(stdout),
				stderr: bounded(stderr),
				event,
				cleanup: { complete: residuals.length === 0, residuals },
			});
		};
		let kill_timer: NodeJS.Timeout | undefined;
		const terminate = (event: 'exit' | 'timeout' | 'abort') => {
			if (terminal_event) return;
			terminal_event = event;
			signal_group('SIGTERM');
			kill_timer = setTimeout(() => {
				signal_group('SIGKILL');
				kill_timer = setTimeout(
					() => finish(event, leader_exit_code),
					100,
				);
			}, 500);
		};
		const abort = () => terminate('abort');
		const timer = setTimeout(
			() => terminate('timeout'),
			options.timeout_ms ?? 0x7fffffff,
		);
		options.signal?.addEventListener('abort', abort, { once: true });
		child.once('error', () => finish('error', null));
		child.once('exit', (code) => {
			leader_exit_code = code;
			if (!terminal_event) terminate('exit');
		});
	});
}

export const default_process_runner: ProcessRunner = async (
	request,
) => {
	const guard_path = fileURLToPath(
		new URL('./guard.js', import.meta.url),
	);
	const args = [
		'--print',
		'--mode',
		'text',
		'--no-session',
		'--approve',
		'--no-extensions',
		'--extension',
		guard_path,
		'--no-skills',
	];
	if (request.role === 'reviewer') args.push('--no-tools');
	else args.push('--tools', 'read,edit,write');
	if (request.model) args.push('--model', request.model);
	args.push(request.prompt);
	const env = create_child_process_env({
		extra_allowed_keys: AUTH_ENV_KEYS,
		explicit_env: {
			PI_FACTORY_HARNESS_PATH: `${request.harness_dir}/harness.json`,
		},
	});
	const result = await run_child('pi', args, { ...request, env });
	const lifecycle =
		result.event === 'timeout'
			? 'timed-out'
			: result.event === 'abort'
				? 'cancelled'
				: result.event === 'error' || result.event === 'lost'
					? 'lost'
					: result.code === 0
						? 'succeeded'
						: 'failed';
	return {
		lifecycle,
		exit_code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		identity: { model: request.model },
		cleanup: result.cleanup,
	};
};

export const default_command_runner: CommandRunner = async (
	command,
	cwd,
	signal,
	timeout_ms,
) => {
	const result = await run_child('bash', ['-lc', command], {
		cwd,
		signal,
		timeout_ms,
	});
	return {
		command,
		ok: result.event === 'exit' && result.code === 0,
		exit_code: result.code,
		output: bounded(
			[result.stdout, result.stderr].filter(Boolean).join('\n'),
		),
		cleanup: result.cleanup,
		lifecycle:
			result.event === 'timeout'
				? 'timed-out'
				: result.event === 'abort'
					? 'cancelled'
					: result.event === 'error' || result.event === 'lost'
						? 'lost'
						: 'settled',
	};
};
