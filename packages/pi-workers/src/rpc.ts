import type {
	RpcCommand,
	RpcExtensionUIResponse,
} from '@earendil-works/pi-coding-agent';
import {
	execFile,
	spawn,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export type RpcRecord = Record<string, unknown>;

export interface ProcessOptions {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	on_record(record: RpcRecord): void;
	on_exit(error: Error): void;
}

export class WorkerProcess {
	private child?: ChildProcessWithoutNullStreams;
	private pending = new Map<
		string,
		{
			resolve(value: RpcRecord): void;
			reject(error: Error): void;
			timer: NodeJS.Timeout;
		}
	>();
	private next_id = 0;
	private stderr = '';
	private exit_error?: Error;
	private stopped?: Promise<void>;
	private closed = false;
	private resolve_exit!: () => void;
	private exited = new Promise<void>((resolve) => {
		this.resolve_exit = resolve;
	});

	constructor(private options: ProcessOptions) {}

	get pid(): number | undefined {
		return this.child?.pid;
	}
	get alive(): boolean {
		return !!this.child && !this.exit_error;
	}

	start(): void {
		this.child = spawn(this.options.command, this.options.args, {
			cwd: this.options.cwd,
			env: this.options.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: process.platform !== 'win32',
		});
		const decoder = new StringDecoder('utf8');
		let buffer = '';
		this.child.stdout.on('data', (chunk: Buffer) => {
			buffer += decoder.write(chunk);
			let index: number;
			// JSONL splits only on LF, not Unicode paragraph/line separators.
			while ((index = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, index).replace(/\r$/, '');
				buffer = buffer.slice(index + 1);
				if (!line) continue;
				try {
					const record: RpcRecord = JSON.parse(line);
					const pending =
						typeof record.id === 'string'
							? this.pending.get(record.id)
							: undefined;
					if (record.type === 'response' && pending) {
						clearTimeout(pending.timer);
						this.pending.delete(record.id as string);
						if (record.success === false)
							pending.reject(new Error(String(record.error)));
						else pending.resolve((record.data ?? {}) as RpcRecord);
					} else if (record.type !== 'response') {
						this.options.on_record(record);
					}
				} catch (error) {
					this.finish(
						error instanceof Error ? error : new Error(String(error)),
					);
					void this.stop();
					return;
				}
			}
		});
		this.child.stderr.on('data', (chunk: Buffer) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-4000);
		});
		this.child.stdin.on('error', (error) => this.finish(error));
		this.child.once('error', (error) => this.finish(error));
		this.child.once('close', (code, signal) => {
			this.closed = true;
			this.finish(
				new Error(
					`Worker exited (${signal ?? code})${this.stderr ? ': ' + this.stderr : ''}`,
				),
			);
			this.resolve_exit();
		});
	}

	private finish(error: Error): void {
		if (this.exit_error) return;
		this.exit_error = error;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.options.on_exit(error);
	}

	write(record: RpcCommand | RpcExtensionUIResponse): void {
		if (!this.alive || !this.child?.stdin.writable)
			throw this.exit_error ?? new Error('Worker is not writable');
		this.child.stdin.write(JSON.stringify(record) + '\n');
	}

	request(
		command: RpcCommand,
		timeout_ms = 30_000,
	): Promise<RpcRecord> {
		const id = `worker-${++this.next_id}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC ${command.type} timed out`));
			}, timeout_ms);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.write({ ...command, id });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	stop(): Promise<void> {
		this.stopped ??= this.stop_process();
		return this.stopped;
	}

	private async stop_process(): Promise<void> {
		const child = this.child;
		if (!child || this.closed) return;
		if (this.alive) {
			try {
				this.write({ type: 'abort' });
			} catch {}
			child.stdin.end();
		}
		const wait = async (ms: number) => {
			let timer: NodeJS.Timeout | undefined;
			await Promise.race([
				this.exited,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, ms);
				}),
			]);
			clearTimeout(timer);
		};
		await wait(1000);
		// Never signal a reaped process group: its id could have been reused.
		if (this.closed) return;
		// A descendant holding stdout can outlive Pi; terminate the owned group.
		if (child.pid && process.platform !== 'win32') {
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {}
			await wait(250);
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {}
		} else if (child.pid && child.exitCode === null) {
			await new Promise<void>((resolve) => {
				execFile(
					'taskkill',
					['/pid', String(child.pid), '/T', '/F'],
					{ timeout: 1000 },
					() => resolve(),
				);
			});
		}
		await wait(1000);
	}
}
