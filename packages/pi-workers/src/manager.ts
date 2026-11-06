import type {
	RpcExtensionUIRequest,
	RpcSessionState,
} from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
	diagnostic_error,
	diagnostic_text,
	worker_snapshot,
} from './diagnostics.js';
import { WorkerProcess, type RpcRecord } from './rpc.js';

export const child_env = 'MY_PI_WORKER_CHILD';
export const max_workers = 4;
const max_result_chars = 16_000;

export interface WorkerInfo {
	parent_session_id?: string;
	group_id?: string;
	id: string;
	name: string;
	cwd: string;
	status: 'starting' | 'running' | 'idle' | 'stopped' | 'failed';
	pid?: number;
	session_id?: string;
	session_file?: string;
	result?: string;
	error?: string;
}

interface Worker {
	info: WorkerInfo;
	process: WorkerProcess;
	active: boolean;
	last_error?: string;
}

export interface WorkerOptions {
	name: string;
	task: string;
	cwd: string;
	model?: string;
	thinking?: string;
}

export type DialogResponse =
	| { value: string }
	| { confirmed: boolean }
	| { cancelled: true };

export interface ManagerOptions {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	session_dir: string;
	parent_session_id?: string;
	group_id?: string;
	get_group_id?(): string;
	on_started?(info: WorkerInfo): void;
	on_complete(info: WorkerInfo): void;
	on_ui(
		id: string,
		request: RpcExtensionUIRequest,
		respond: (response: DialogResponse) => void,
	): void;
	on_dialogs_end(id: string): void;
}

export class WorkerManager {
	private workers = new Map<string, Worker>();
	private disposed = false;

	constructor(private options: ManagerOptions) {}

	list(): WorkerInfo[] {
		return [...this.workers.values()].map((worker) =>
			worker_snapshot(worker.info),
		);
	}

	private find(id: string): Worker {
		const entries = [...this.workers.values()];
		// Explicit identities keep targeting historical workers. A reused name
		// targets its newest owner, never an older stopped or failed process.
		const worker =
			this.workers.get(id) ??
			entries.find((entry) => entry.info.session_id === id) ??
			entries.reverse().find((entry) => entry.info.name === id);
		if (!worker)
			throw new Error(
				'Not an owned worker. Use Team Mode for independently opened sessions.',
			);
		return worker;
	}

	async spawn(
		options: WorkerOptions,
		signal?: AbortSignal,
	): Promise<WorkerInfo> {
		try {
			return await this.spawn_worker(options, signal);
		} catch (error) {
			throw diagnostic_error(error);
		}
	}

	private async spawn_worker(
		options: WorkerOptions,
		signal?: AbortSignal,
	): Promise<WorkerInfo> {
		if (this.disposed) throw new Error('Worker manager is closed');
		signal?.throwIfAborted();
		if (!options.name.trim() || !options.task.trim())
			throw new Error('name and task must not be empty');
		if (!isAbsolute(options.cwd))
			throw new Error('cwd must be an absolute directory path');
		const cwd = realpathSync(options.cwd);
		if (!statSync(cwd).isDirectory())
			throw new Error('cwd must be a directory');
		const alive = [...this.workers.values()].filter(
			(worker) => worker.process.alive,
		);
		if (alive.length >= max_workers)
			throw new Error(
				`At most ${max_workers} live workers; stop an idle worker first`,
			);
		if (alive.some((worker) => worker.info.name === options.name))
			throw new Error('Worker name is already in use');
		const id = randomUUID();
		const info: WorkerInfo = {
			parent_session_id: this.options.parent_session_id,
			group_id:
				this.options.get_group_id?.() ?? this.options.group_id,
			id,
			name: options.name,
			cwd,
			status: 'starting',
		};
		const args = [
			...this.options.args,
			'--mode',
			'rpc',
			'--session-dir',
			join(this.options.session_dir, id),
			'--name',
			options.name,
		];
		if (options.model) args.push('--model', options.model);
		if (options.thinking) args.push('--thinking', options.thinking);
		const env: NodeJS.ProcessEnv = {
			...this.options.env,
			[child_env]: '1',
			MY_PI_TEAM_MEMBER: options.name,
			MY_PI_TEAM_ROLE: 'teammate',
			MY_PI_TEAM_PARENT_SESSION_ID: this.options.parent_session_id,
			MY_PI_TEAM_GROUP_ID: info.group_id,
			MY_PI_WORKER_ID: id,
		};
		delete env.MY_PI_OBSERVABILITY_NAME;
		const worker: Worker = {
			info,
			active: false,
			process: new WorkerProcess({
				command: this.options.command,
				args,
				cwd,
				env,
				on_record: (record) => this.record(worker, record),
				on_exit: (error) => {
					this.options.on_dialogs_end(id);
					if (info.status === 'stopped' || info.status === 'failed')
						return;
					info.status = 'failed';
					info.error = diagnostic_error(error).message;
					worker.active = false;
					void worker.process.stop();
					if (!this.disposed)
						this.options.on_complete(worker_snapshot(info));
				},
			}),
		};
		this.workers.set(id, worker);
		const abort = () => {
			void this.stop(id);
		};
		signal?.addEventListener('abort', abort, { once: true });
		try {
			worker.process.start();
			info.pid = worker.process.pid;
			const state = (await worker.process.request({
				type: 'get_state',
			})) as unknown as RpcSessionState;
			signal?.throwIfAborted();
			if (this.disposed || info.status === 'stopped')
				throw new Error('Worker stopped during startup');
			if (
				options.model &&
				options.model !==
					`${state.model?.provider}/${state.model?.id}`
			)
				throw new Error(
					`Worker did not select requested model ${options.model}`,
				);
			info.session_id = state.sessionId;
			info.session_file = state.sessionFile;
			info.status = 'idle';
			this.options.on_started?.(worker_snapshot(info));
			await this.send(id, options.task);
			signal?.throwIfAborted();
			return worker_snapshot(info);
		} catch (error) {
			if (info.status !== 'stopped') {
				info.status = 'failed';
				info.error = diagnostic_error(error).message;
			}
			await worker.process.stop();
			throw error;
		} finally {
			signal?.removeEventListener('abort', abort);
		}
	}

	async send(
		id: string,
		message: string,
		queue = false,
	): Promise<WorkerInfo> {
		if (this.disposed) throw new Error('Worker manager is closed');
		if (!message.trim()) throw new Error('message must not be empty');
		const worker = this.find(id);
		if (
			!worker.process.alive ||
			worker.info.status === 'stopped' ||
			worker.info.status === 'failed'
		)
			throw new Error('Worker is not running');
		worker.info.status = 'running';
		try {
			const accepted = await worker.process.request({
				type: 'prompt',
				message,
				streamingBehavior: queue ? 'followUp' : 'steer',
			});
			if (accepted.disposition === 'handled' && !worker.active)
				worker.info.status = 'idle';
		} catch (error) {
			if (!['stopped', 'failed'].includes(worker.info.status)) {
				worker.info.status = 'failed';
				worker.info.error = diagnostic_error(error).message;
			}
			await worker.process.stop();
			throw diagnostic_error(error);
		}
		return worker_snapshot(worker.info);
	}

	async stop(id: string): Promise<WorkerInfo> {
		const worker = this.find(id);
		worker.info.status = 'stopped';
		worker.active = false;
		this.options.on_dialogs_end(worker.info.id);
		await worker.process.stop();
		return worker_snapshot(worker.info);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await Promise.all(
			[...this.workers.keys()].map((id) => this.stop(id)),
		);
	}

	private record(worker: Worker, event: RpcRecord): void {
		const info = worker.info;
		if (
			info.status === 'stopped' ||
			info.status === 'failed' ||
			this.disposed
		)
			return;
		if (event.type === 'extension_ui_request') {
			this.options.on_ui(
				info.id,
				event as unknown as RpcExtensionUIRequest,
				(response) => {
					try {
						worker.process.write({
							type: 'extension_ui_response',
							id: event.id as string,
							...response,
						});
					} catch {}
				},
			);
		} else if (event.type === 'agent_start') {
			if (!worker.active) {
				info.result = undefined;
				info.error = undefined;
				worker.last_error = undefined;
			}
			worker.active = true;
			info.status = 'running';
		} else if (event.type === 'message_end') {
			const message = event.message as {
				role?: string;
				content?: { type: string; text?: string }[];
				stopReason?: string;
				errorMessage?: string;
			};
			if (message.role !== 'assistant') return;
			const text = message.content
				? diagnostic_text(
						message.content
							.filter((block) => block.type === 'text')
							.map((block) => block.text ?? '')
							.join('\n'),
					)
				: undefined;
			info.result =
				text && text.length > max_result_chars
					? text.slice(0, max_result_chars) +
						'\n[Report truncated; full output is in the worker session.]'
					: text;
			worker.last_error =
				message.stopReason === 'error' ||
				message.stopReason === 'aborted'
					? diagnostic_text(
							message.errorMessage || message.stopReason,
						)
					: undefined;
		} else if (event.type === 'turn_end') {
			this.options.on_dialogs_end(info.id);
		} else if (event.type === 'agent_settled') {
			this.options.on_dialogs_end(info.id);
			if (!worker.active) return;
			worker.active = false;
			info.status = 'idle';
			info.error = event.aborted
				? 'Run aborted'
				: worker.last_error?.slice(0, max_result_chars);
			this.options.on_complete(worker_snapshot(info));
		}
	}
}
