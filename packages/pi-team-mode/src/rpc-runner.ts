import {
	spawn,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { capture_process_identity } from './process-identity.js';
import {
	build_rpc_teammate_args,
	resolve_rpc_command,
} from './rpc/command.js';
import { create_rpc_teammate_env } from './rpc/env.js';
import {
	json_line,
	next_rpc_request_id,
	normalize_member_name,
} from './rpc/protocol.js';
import { TeamStore, type TeamWorkspaceMode } from './store.js';

export { build_rpc_teammate_args } from './rpc/command.js';
export { create_rpc_teammate_env } from './rpc/env.js';

export interface RpcTeammateOptions {
	team_id: string;
	member: string;
	cwd: string;
	team_root: string;
	extension_path: string;
	model?: string;
	thinking?: string;
	system_prompt?: string;
	tools?: string[];
	skills?: string[];
	profile?: string;
	workspace_mode?: TeamWorkspaceMode;
	worktree_path?: string;
	branch?: string;
	mutating?: boolean;
	pi_command?: string;
	on_exit?: (member: string) => void;
}

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export class RpcTeammate {
	readonly team_id: string;
	readonly member: string;
	readonly cwd: string;
	readonly store: TeamStore;
	private readonly options: RpcTeammateOptions;
	private proc?: ChildProcessWithoutNullStreams;
	private buffer = '';
	private decoder = new StringDecoder('utf8');
	private pending = new Map<string, PendingRequest>();
	private idle_waiters: Array<() => void> = [];
	private status: 'idle' | 'running' | 'offline' = 'idle';
	private closed = false;

	constructor(store: TeamStore, options: RpcTeammateOptions) {
		this.store = store;
		this.options = options;
		this.team_id = options.team_id;
		this.member = normalize_member_name(options.member);
		this.cwd = options.cwd;
	}

	get pid(): number | undefined {
		return this.proc?.pid;
	}

	get is_running(): boolean {
		return Boolean(this.proc && !this.closed);
	}

	async start(): Promise<void> {
		if (this.proc) return;
		const session_dir = join(
			this.store.team_dir(this.team_id),
			'sessions',
			this.member,
		);
		mkdirSync(session_dir, { recursive: true, mode: 0o700 });
		mkdirSync(dirname(this.options.extension_path), {
			recursive: true,
		});

		const command_info = resolve_rpc_command(
			this.options.pi_command ?? process.env.MY_PI_TEAM_PI_COMMAND,
		);
		const args = build_rpc_teammate_args(
			this.options,
			session_dir,
			command_info,
		);
		const { command } = command_info;

		const proc = spawn(command, args, {
			cwd: this.cwd,
			shell: false,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_rpc_teammate_env(
				this.options,
				this.team_id,
				this.member,
			),
		});

		this.proc = proc;
		this.closed = false;
		const process_identity = proc.pid
			? capture_process_identity(proc.pid, {
					session_dir,
					marker: '--session-dir',
				})
			: undefined;
		await this.store.upsert_member(this.team_id, {
			name: this.member,
			status: 'idle',
			cwd: this.cwd,
			model: this.options.model,
			pid: proc.pid,
			process_identity,
			profile: this.options.profile,
			workspace_mode: this.options.workspace_mode,
			worktree_path: this.options.worktree_path,
			branch: this.options.branch,
			mutating: this.options.mutating,
		});

		proc.stdout.on('data', (chunk) => this.handle_stdout(chunk));
		proc.stderr.on('data', (chunk) => {
			this.store.append_event(this.team_id, 'member_stderr', {
				member: this.member,
				text: chunk.toString('utf8'),
			});
		});
		proc.on('error', (error) => {
			void this.mark_offline(error);
		});
		proc.on('close', (code, signal) => {
			void this.mark_offline(
				new Error(
					`RPC teammate exited (${code ?? signal ?? 'unknown'})`,
				),
			);
			this.store.append_event(this.team_id, 'member_exit', {
				member: this.member,
				code,
				signal,
			});
		});

		try {
			const state = await this.request({ type: 'get_state' }, 15_000);
			const session_file =
				state?.data?.sessionFile ?? state?.data?.session_file;
			if (session_file) {
				await this.store.upsert_member(this.team_id, {
					name: this.member,
					status: 'idle',
					session_file,
					pid: proc.pid,
					process_identity,
				});
			}
		} catch (error) {
			proc.kill('SIGTERM');
			setTimeout(() => {
				if (!proc.killed) proc.kill('SIGKILL');
			}, 3000).unref();
			await this.mark_offline(
				error instanceof Error ? error : new Error(String(error)),
			);
			this.store.append_event(this.team_id, 'member_start_failed', {
				member: this.member,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		await this.request(
			{
				type: 'set_session_name',
				name: `team:${this.team_id}/${this.member}`,
			},
			10_000,
		).catch(() => undefined);
	}

	async prompt(message: string): Promise<void> {
		await this.mark_busy();
		try {
			await this.request({ type: 'prompt', message }, 10_000);
		} catch (error) {
			await this.mark_blocked(error);
			throw error;
		}
	}

	async follow_up(message: string): Promise<void> {
		await this.mark_busy();
		try {
			await this.request({ type: 'follow_up', message }, 10_000);
		} catch (error) {
			await this.mark_blocked(error);
			throw error;
		}
	}

	async steer(message: string): Promise<void> {
		await this.mark_busy();
		try {
			await this.request({ type: 'steer', message }, 10_000);
		} catch (error) {
			await this.mark_blocked(error);
			throw error;
		}
	}

	async abort(): Promise<void> {
		await this.request({ type: 'abort' }, 10_000).catch(
			() => undefined,
		);
	}

	async wait_for_idle(timeout_ms = 120_000): Promise<void> {
		if (this.closed || this.status !== 'running') return;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.idle_waiters = this.idle_waiters.filter(
					(waiter) => waiter !== done,
				);
				reject(
					new Error(
						`Timed out waiting for ${this.member} to go idle`,
					),
				);
			}, timeout_ms);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			this.idle_waiters.push(done);
		});
	}

	async shutdown(reason = 'team shutdown requested'): Promise<void> {
		if (!this.proc || this.closed) return;
		await this.follow_up(
			`Shutdown requested: ${reason}. Stop after acknowledging.`,
		).catch(() => undefined);
		this.proc.kill('SIGTERM');
		this.status = 'offline';
		await this.store.upsert_member(this.team_id, {
			name: this.member,
			status: 'offline',
		});
		setTimeout(() => {
			if (this.proc && !this.closed) this.proc.kill('SIGKILL');
		}, 3000).unref();
	}

	private request(
		command: Record<string, unknown>,
		timeout_ms: number,
	): Promise<any> {
		if (!this.proc || this.closed)
			throw new Error(`Teammate ${this.member} is not running`);
		const id = next_rpc_request_id();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(`RPC request timed out: ${String(command.type)}`),
				);
			}, timeout_ms);
			this.pending.set(id, { resolve, reject, timer });
			this.proc!.stdin.write(
				json_line({ id, ...command }),
				(error) => {
					if (!error) return;
					const pending = this.pending.get(id);
					if (!pending) return;
					this.pending.delete(id);
					clearTimeout(pending.timer);
					pending.reject(error);
				},
			);
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
				this.team_id,
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

		void this.handle_event(event);
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

	private async mark_busy(): Promise<void> {
		if (this.closed) return;
		this.status = 'running';
		await this.store.upsert_member(this.team_id, {
			name: this.member,
			status: 'running_attached',
		});
	}

	private async mark_blocked(error: unknown): Promise<void> {
		if (this.closed) return;
		const message =
			error instanceof Error ? error.message : String(error);
		this.status = 'idle';
		this.resolve_idle_waiters();
		await this.clear_unacknowledged_deliveries();
		await this.store.upsert_member(this.team_id, {
			name: this.member,
			status: 'blocked',
		});
		this.store.append_event(this.team_id, 'member_rpc_error', {
			member: this.member,
			error: message,
		});
	}

	private async mark_offline(error: Error): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.status = 'offline';
		this.resolve_idle_waiters();
		this.reject_all(error);
		await this.clear_unacknowledged_deliveries();
		await this.block_in_progress_tasks();
		try {
			await this.store.upsert_member(this.team_id, {
				name: this.member,
				status: 'offline',
			});
		} catch {
			// The team store may have been removed during test or explicit
			// cleanup while the child process was still closing.
		}
		this.options.on_exit?.(this.member);
	}

	private async block_in_progress_tasks(): Promise<void> {
		try {
			for (const task of this.store.list_tasks(this.team_id)) {
				if (
					task.status !== 'in_progress' ||
					task.assignee !== this.member
				) {
					continue;
				}
				await this.store.update_task(this.team_id, task.id, {
					status: 'blocked',
					result: `Blocked because teammate ${this.member} went offline.`,
				});
			}
		} catch {
			// Best-effort recovery only; preserve the original shutdown/error path.
		}
	}

	private async clear_unacknowledged_deliveries(): Promise<void> {
		try {
			await this.store.clear_unacknowledged_deliveries(
				this.team_id,
				this.member,
			);
		} catch {
			// Best-effort recovery only; never mask the original runner state change.
		}
	}

	private async touch_member(): Promise<void> {
		if (this.closed) return;
		await this.store.upsert_member(this.team_id, {
			name: this.member,
			status: this.status,
		});
	}

	private async handle_event(event: any): Promise<void> {
		if (event.type === 'agent_start') {
			await this.mark_busy();
		} else if (event.type === 'agent_end') {
			this.status = 'idle';
			await this.store.upsert_member(this.team_id, {
				name: this.member,
				status: 'idle',
			});
			const waiters = this.idle_waiters.splice(0);
			for (const waiter of waiters) waiter();
		} else if (event.type === 'tool_execution_start') {
			await this.mark_busy();
		}

		if (
			event.type === 'agent_start' ||
			event.type === 'agent_end' ||
			event.type === 'tool_execution_start' ||
			event.type === 'tool_execution_end' ||
			event.type === 'message_end'
		) {
			await this.touch_member();
			this.store.append_event(this.team_id, 'member_rpc_event', {
				member: this.member,
				event,
			});
		}
	}

	private resolve_idle_waiters(): void {
		const waiters = this.idle_waiters.splice(0);
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
