import type {
	RpcCommand,
	RpcExtensionUIResponse,
} from '@earendil-works/pi-coding-agent';
import {
	execFile,
	spawn,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import * as v from 'valibot';

type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type RpcRecord = Record<string, JsonValue>;

/** Correlation id of a response record; any non-string id matches nothing. */
const rpc_record_id_schema = v.looseObject({
	id: v.fallback(v.optional(v.string()), undefined),
});

interface ProcessIdentity {
	pid: number;
	group: number;
	started: string;
	state: string;
}

/** @internal Linux comm fields can contain spaces and closing parentheses. */
export function parse_process_stat(stat: string): ProcessIdentity {
	const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');

	return {
		pid: Number(stat.slice(0, stat.indexOf(' '))),
		group: Number(fields[2]),
		started: fields[19],
		state: fields[0],
	};
}

function process_identity(pid: number): ProcessIdentity | undefined {
	try {
		return parse_process_stat(
			readFileSync(`/proc/${pid}/stat`, 'utf8'),
		);
	} catch {
		return undefined;
	}
}

/** @internal Compare identities, not just PIDs, before signalling a group. */
export function same_live_process(
	identity: ProcessIdentity,
	current: ProcessIdentity | undefined,
): boolean {
	return (
		!!current &&
		current.pid === identity.pid &&
		current.group === identity.group &&
		current.started === identity.started &&
		current.state !== 'Z' &&
		current.state !== 'X'
	);
}

function group_members(group: number): ProcessIdentity[] {
	try {
		return readdirSync('/proc').flatMap((entry) => {
			if (!/^\d+$/.test(entry)) return [];
			const identity = process_identity(Number(entry));

			return identity?.group === group ? [identity] : [];
		});
	} catch {
		return [];
	}
}

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
	private stderr_omitted = false;
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

					const parsed_id = v.safeParse(rpc_record_id_schema, record);

					const id = parsed_id.success
						? parsed_id.output.id
						: undefined;

					const pending =
						id === undefined ? undefined : this.pending.get(id);

					if (
						record.type === 'response' &&
						id !== undefined &&
						pending
					) {
						clearTimeout(pending.timer);
						this.pending.delete(id);

						const failure: unknown = record.error;

						if (record.success === false)
							pending.reject(new Error(String(failure)));
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
			if (this.stderr_omitted) return;
			const complete = this.stderr + chunk.toString();

			// A raw suffix can lose the label needed to recognize a secret.
			// Keep the complete diagnostic or omit it, never a partial tail.
			if (complete.length > 4000) {
				this.stderr = '[stderr omitted: exceeded 4000 characters]';
				this.stderr_omitted = true;
			} else this.stderr = complete;
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
		// Snapshot before requesting EOF, while the leader still proves ownership.
		// Keep descendant identities: closing Pi's pipes does not retire its group.
		let members: ProcessIdentity[] | undefined;

		if (process.platform === 'linux' && child.pid) {
			const leader = process_identity(child.pid);

			if (leader?.group === child.pid) {
				const snapshot = group_members(child.pid);

				if (same_live_process(leader, process_identity(leader.pid)))
					members = snapshot;
			}
		}

		const owns_group = () =>
			members!.some((member) =>
				same_live_process(member, process_identity(member.pid)),
			);

		const signal_group = (signal: NodeJS.Signals) => {
			if (members) {
				if (!owns_group()) return;
				const snapshot = group_members(child.pid!);

				// Revalidate after scanning, including before SIGKILL escalation.
				if (!owns_group()) return;
				members = snapshot;

				if (!owns_group()) return;
			} else if (
				this.closed ||
				child.exitCode !== null ||
				child.signalCode !== null
			) {
				// Without identity tracking, never signal a reaped/reused group.
				return;
			}

			try {
				process.kill(-child.pid!, signal);
			} catch {}
		};

		if (this.alive) {
			try {
				this.write({ type: 'abort' });
			} catch {}

			child.stdin.end();
		}

		const wait = async (ms: number) => {
			if (members) {
				const deadline = Date.now() + ms;

				while (!this.closed || owns_group()) {
					const remaining = deadline - Date.now();

					if (remaining <= 0) break;
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(25, remaining)),
					);
				}

				return;
			}

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

		if (!members && this.closed) return;

		if (child.pid && process.platform !== 'win32') {
			signal_group('SIGTERM');
			await wait(250);
			signal_group('SIGKILL');
		} else if (
			child.pid &&
			child.exitCode === null &&
			child.signalCode === null
		) {
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
