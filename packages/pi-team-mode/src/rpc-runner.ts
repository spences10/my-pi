import { create_child_process_env } from '@spences10/pi-child-env';
import {
	spawn,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { TeamStore } from './store.js';

export interface RpcTeammateOptions {
	teamId: string;
	member: string;
	cwd: string;
	teamRoot: string;
	extensionPath: string;
	model?: string;
	thinking?: string;
	piCommand?: string;
}

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

let next_request_id = 1;

function next_id(): string {
	return `team-rpc-${next_request_id++}`;
}

function json_line(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

function normalize_member_name(value: string): string {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed === '.' ||
		trimmed === '..' ||
		!/^[a-zA-Z0-9_.-]+$/.test(trimmed)
	) {
		throw new Error(
			'member must contain only letters, numbers, dots, underscores, and hyphens',
		);
	}
	return trimmed;
}

function resolve_rpc_command(override: string | undefined): {
	command: string;
	prefixArgs: string[];
} {
	if (override?.trim())
		return { command: override.trim(), prefixArgs: [] };
	if (process.argv[1]) {
		return {
			command: process.execPath,
			prefixArgs: [process.argv[1]],
		};
	}
	return { command: 'pi', prefixArgs: [] };
}

export function create_rpc_teammate_env(
	options: Pick<RpcTeammateOptions, 'teamRoot' | 'extensionPath'>,
	teamId: string,
	member: string,
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const normalized_member = normalize_member_name(member);
	return create_child_process_env({
		profile: 'team-mode',
		source_env,
		explicit_env: {
			MY_PI_TEAM_MODE_ROOT: options.teamRoot,
			MY_PI_ACTIVE_TEAM_ID: teamId,
			MY_PI_TEAM_MEMBER: normalized_member,
			MY_PI_TEAM_ROLE: 'teammate',
			MY_PI_TEAM_EXTENSION_PATH: options.extensionPath,
		},
	});
}

export class RpcTeammate {
	readonly teamId: string;
	readonly member: string;
	readonly cwd: string;
	readonly store: TeamStore;
	private readonly options: RpcTeammateOptions;
	private proc?: ChildProcessWithoutNullStreams;
	private buffer = '';
	private decoder = new StringDecoder('utf8');
	private pending = new Map<string, PendingRequest>();
	private idleWaiters: Array<() => void> = [];
	private status: 'idle' | 'running' | 'offline' = 'idle';
	private closed = false;

	constructor(store: TeamStore, options: RpcTeammateOptions) {
		this.store = store;
		this.options = options;
		this.teamId = options.teamId;
		this.member = normalize_member_name(options.member);
		this.cwd = options.cwd;
	}

	get pid(): number | undefined {
		return this.proc?.pid;
	}

	get isRunning(): boolean {
		return Boolean(this.proc && !this.closed);
	}

	async start(): Promise<void> {
		if (this.proc) return;
		const session_dir = join(
			this.store.team_dir(this.teamId),
			'sessions',
			this.member,
		);
		mkdirSync(session_dir, { recursive: true, mode: 0o700 });
		mkdirSync(dirname(this.options.extensionPath), {
			recursive: true,
		});

		const { command, prefixArgs } = resolve_rpc_command(
			this.options.piCommand ?? process.env.MY_PI_TEAM_PI_COMMAND,
		);
		const args = [
			...prefixArgs,
			'--mode',
			'rpc',
			'--session-dir',
			session_dir,
			'-e',
			this.options.extensionPath,
		];
		if (this.options.model) args.push('--model', this.options.model);
		if (this.options.thinking)
			args.push('--thinking', this.options.thinking);

		const proc = spawn(command, args, {
			cwd: this.cwd,
			shell: false,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_rpc_teammate_env(
				this.options,
				this.teamId,
				this.member,
			),
		});

		this.proc = proc;
		this.closed = false;
		this.store.upsert_member(this.teamId, {
			name: this.member,
			status: 'idle',
			cwd: this.cwd,
			model: this.options.model,
			pid: proc.pid,
		});

		proc.stdout.on('data', (chunk) => this.handle_stdout(chunk));
		proc.stderr.on('data', (chunk) => {
			this.store.append_event(this.teamId, 'member_stderr', {
				member: this.member,
				text: chunk.toString('utf8'),
			});
		});
		proc.on('error', (error) => {
			this.closed = true;
			this.status = 'offline';
			this.resolve_idle_waiters();
			this.reject_all(error);
			this.store.upsert_member(this.teamId, {
				name: this.member,
				status: 'offline',
			});
		});
		proc.on('close', (code, signal) => {
			this.closed = true;
			this.status = 'offline';
			this.resolve_idle_waiters();
			this.reject_all(
				new Error(
					`RPC teammate exited (${code ?? signal ?? 'unknown'})`,
				),
			);
			this.store.upsert_member(this.teamId, {
				name: this.member,
				status: 'offline',
			});
			this.store.append_event(this.teamId, 'member_exit', {
				member: this.member,
				code,
				signal,
			});
		});

		try {
			const state = await this.request({ type: 'get_state' }, 15_000);
			if (state?.data?.sessionFile) {
				this.store.upsert_member(this.teamId, {
					name: this.member,
					status: 'idle',
					sessionFile: state.data.sessionFile,
					pid: proc.pid,
				});
			}
		} catch (error) {
			this.closed = true;
			this.status = 'offline';
			proc.kill('SIGTERM');
			setTimeout(() => {
				if (!proc.killed) proc.kill('SIGKILL');
			}, 3000).unref();
			this.reject_all(
				error instanceof Error ? error : new Error(String(error)),
			);
			this.store.upsert_member(this.teamId, {
				name: this.member,
				status: 'offline',
			});
			this.store.append_event(this.teamId, 'member_start_failed', {
				member: this.member,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		await this.request(
			{
				type: 'set_session_name',
				name: `team:${this.teamId}/${this.member}`,
			},
			10_000,
		).catch(() => undefined);
	}

	async prompt(message: string): Promise<void> {
		this.mark_busy();
		try {
			await this.request({ type: 'prompt', message }, 10_000);
		} catch (error) {
			this.mark_blocked(error);
			throw error;
		}
	}

	async followUp(message: string): Promise<void> {
		this.mark_busy();
		try {
			await this.request({ type: 'follow_up', message }, 10_000);
		} catch (error) {
			this.mark_blocked(error);
			throw error;
		}
	}

	async steer(message: string): Promise<void> {
		this.mark_busy();
		try {
			await this.request({ type: 'steer', message }, 10_000);
		} catch (error) {
			this.mark_blocked(error);
			throw error;
		}
	}

	async abort(): Promise<void> {
		await this.request({ type: 'abort' }, 10_000).catch(
			() => undefined,
		);
	}

	async waitForIdle(timeoutMs = 120_000): Promise<void> {
		if (this.closed || this.status !== 'running') return;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.idleWaiters = this.idleWaiters.filter(
					(waiter) => waiter !== done,
				);
				reject(
					new Error(
						`Timed out waiting for ${this.member} to go idle`,
					),
				);
			}, timeoutMs);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			this.idleWaiters.push(done);
		});
	}

	async shutdown(reason = 'team shutdown requested'): Promise<void> {
		if (!this.proc || this.closed) return;
		await this.followUp(
			`Shutdown requested: ${reason}. Stop after acknowledging.`,
		).catch(() => undefined);
		this.proc.kill('SIGTERM');
		this.status = 'offline';
		this.store.upsert_member(this.teamId, {
			name: this.member,
			status: 'offline',
		});
		setTimeout(() => {
			if (this.proc && !this.closed) this.proc.kill('SIGKILL');
		}, 3000).unref();
	}

	private request(
		command: Record<string, unknown>,
		timeoutMs: number,
	): Promise<any> {
		if (!this.proc || this.closed)
			throw new Error(`Teammate ${this.member} is not running`);
		const id = next_id();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(`RPC request timed out: ${String(command.type)}`),
				);
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.proc!.stdin.write(json_line({ id, ...command }));
		});
	}

	private send(command: Record<string, unknown>): void {
		if (!this.proc || this.closed) return;
		this.proc.stdin.write(json_line(command));
	}

	private handle_stdout(chunk: Buffer): void {
		this.buffer += this.decoder.write(chunk);
		while (true) {
			const index = this.buffer.indexOf('\n');
			if (index === -1) return;
			const line = this.buffer.slice(0, index).replace(/\r$/, '');
			this.buffer = this.buffer.slice(index + 1);
			if (line.trim()) this.handle_line(line);
		}
	}

	private handle_line(line: string): void {
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			this.store.append_event(
				this.teamId,
				'member_output_parse_error',
				{
					member: this.member,
					line,
				},
			);
			return;
		}

		if (
			event.type === 'response' &&
			event.id &&
			this.pending.has(event.id)
		) {
			const pending = this.pending.get(event.id)!;
			this.pending.delete(event.id);
			clearTimeout(pending.timer);
			if (event.success === false)
				pending.reject(
					new Error(event.error ?? 'RPC request failed'),
				);
			else pending.resolve(event);
			return;
		}

		if (event.type === 'extension_ui_request') {
			this.handle_extension_ui_request(event);
			return;
		}

		this.handle_event(event);
	}

	private handle_extension_ui_request(event: any): void {
		if (!event.id) return;
		if (event.method === 'confirm') {
			this.send({
				type: 'extension_ui_response',
				id: event.id,
				confirmed: false,
			});
		} else if (['select', 'input', 'editor'].includes(event.method)) {
			this.send({
				type: 'extension_ui_response',
				id: event.id,
				cancelled: true,
			});
		}
	}

	private mark_busy(): void {
		if (this.closed) return;
		this.status = 'running';
		this.store.upsert_member(this.teamId, {
			name: this.member,
			status: 'running',
		});
	}

	private mark_blocked(error: unknown): void {
		if (this.closed) return;
		const message =
			error instanceof Error ? error.message : String(error);
		this.status = 'idle';
		this.resolve_idle_waiters();
		this.store.upsert_member(this.teamId, {
			name: this.member,
			status: 'blocked',
		});
		this.store.append_event(this.teamId, 'member_rpc_error', {
			member: this.member,
			error: message,
		});
	}

	private handle_event(event: any): void {
		if (event.type === 'agent_start') {
			this.mark_busy();
		} else if (event.type === 'agent_end') {
			this.status = 'idle';
			this.store.upsert_member(this.teamId, {
				name: this.member,
				status: 'idle',
			});
			const waiters = this.idleWaiters.splice(0);
			for (const waiter of waiters) waiter();
		} else if (event.type === 'tool_execution_start') {
			this.mark_busy();
		}

		if (
			event.type === 'agent_start' ||
			event.type === 'agent_end' ||
			event.type === 'tool_execution_start' ||
			event.type === 'tool_execution_end' ||
			event.type === 'message_end'
		) {
			this.store.append_event(this.teamId, 'member_rpc_event', {
				member: this.member,
				event,
			});
		}
	}

	private resolve_idle_waiters(): void {
		const waiters = this.idleWaiters.splice(0);
		for (const waiter of waiters) waiter();
	}

	private reject_all(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}
	}
}
