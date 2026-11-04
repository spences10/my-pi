import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	WorkerProcess,
	parse_process_stat,
	same_live_process,
	type RpcRecord,
} from './rpc.js';

const fixture = fileURLToPath(
	new URL('./fixtures/process-tree.ts', import.meta.url),
);
const workers: WorkerProcess[] = [];
const directories: string[] = [];
const descendants = new Map<number, string>();
const independent: ChildProcess[] = [];

function stat(
	pid: number,
): { state: string; identity: string } | undefined {
	try {
		const content = readFileSync(`/proc/${pid}/stat`, 'utf8');
		const fields = content
			.slice(content.lastIndexOf(')') + 2)
			.split(' ');
		return { state: fields[0], identity: fields[19] };
	} catch {
		return undefined;
	}
}

function running(pid: number): boolean {
	const current = stat(pid);
	return !!current && current.state !== 'Z' && current.state !== 'X';
}

function directory(): string {
	const path = mkdtempSync(join(tmpdir(), 'pi-workers-cleanup-'));
	directories.push(path);
	return path;
}

async function start(mode: string) {
	const cwd = directory();
	const records: RpcRecord[] = [];
	const exits: Error[] = [];
	const worker = new WorkerProcess({
		command: process.execPath,
		args: [fixture, 'owner', mode, cwd],
		cwd,
		env: process.env,
		on_record: (record) => records.push(record),
		on_exit: (error) => exits.push(error),
	});
	workers.push(worker);
	worker.start();
	await expect
		.poll(() => records.some((r) => r.type === 'ready'))
		.toBe(true);
	let descendant: number | undefined;
	if (mode !== 'graceful') {
		descendant = Number(
			readFileSync(join(cwd, 'descendant'), 'utf8'),
		);
		descendants.set(descendant, stat(descendant)!.identity);
	}
	return { worker, records, exits, descendant, cwd };
}

afterEach(async () => {
	vi.restoreAllMocks();
	try {
		await Promise.all(
			workers.splice(0).map((worker) => worker.stop()),
		);
	} finally {
		// Discover even descendants whose owner never reached its ready record.
		for (const path of directories) {
			try {
				const identity = parse_process_stat(
					readFileSync(join(path, 'identity'), 'utf8'),
				);
				descendants.set(identity.pid, identity.started);
			} catch {}
		}
		// Even a failed assertion or the unfixed implementation must not leak
		// the redirected grandchildren created by this suite.
		for (const [pid, identity] of descendants) {
			if (stat(pid)?.identity === identity && running(pid)) {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {}
			}
		}
		for (const child of independent.splice(0)) {
			if (child.exitCode !== null || child.signalCode !== null)
				continue;
			const closed = once(child, 'close');
			child.kill('SIGKILL');
			await closed;
		}
		for (const pid of descendants.keys()) {
			await expect.poll(() => running(pid)).toBe(false);
		}
		descendants.clear();
		for (const path of directories.splice(0))
			rmSync(path, { recursive: true, force: true });
	}
});

describe('Linux process identities', () => {
	const fields = Array<string>(20).fill('0');
	fields[0] = 'S';
	fields[2] = '42';
	fields[19] = '9007199254740993';
	const identity = {
		pid: 43,
		group: 42,
		started: '9007199254740993',
		state: 'S',
	};

	it('parses comm with spaces and parentheses without shifting identity fields', () => {
		expect(
			parse_process_stat(`43 (pi ) (worker)) ${fields.join(' ')}`),
		).toEqual(identity);
	});

	it('requires the same PID, group and start time and rejects dead processes', () => {
		expect(
			same_live_process(identity, { ...identity, state: 'R' }),
		).toBe(true);
		for (const current of [
			undefined,
			{ ...identity, pid: 44 },
			{ ...identity, group: 99 },
			{ ...identity, started: '9007199254740994' },
			{ ...identity, state: 'Z' },
			{ ...identity, state: 'X' },
		])
			expect(same_live_process(identity, current)).toBe(false);
	});
});

describe.skipIf(process.platform !== 'linux')(
	'worker process cleanup',
	() => {
		it('uses abort and stdin EOF for normal graceful shutdown', async () => {
			const { worker, records, exits } = await start('graceful');
			const signal = vi.spyOn(process, 'kill');
			const stopping = worker.stop();
			expect(worker.stop()).toBe(stopping);
			await stopping;
			expect(records).toContainEqual({
				type: 'shutdown',
				aborted: true,
			});
			expect(records.some((r) => r.type === 'signal')).toBe(false);
			expect(exits).toHaveLength(1);
			expect(exits[0].message).toBe('Worker exited (0)');
			expect(
				signal.mock.calls.filter(([, kind]) => kind !== 0),
			).toEqual([]);
			expect(running(worker.pid!)).toBe(false);
		});

		it('terminates a redirected descendant after its owner exits gracefully', async () => {
			const { worker, records, exits, descendant, cwd } =
				await start('tree');
			await worker.stop();
			expect(records).toContainEqual({
				type: 'shutdown',
				aborted: true,
			});
			expect(exits[0].message).toBe('Worker exited (0)');
			expect(readFileSync(join(cwd, 'term'), 'utf8')).toMatch(
				/^\d+$/,
			);
			expect(running(descendant!)).toBe(false);
		});

		it('bounds escalation for a redirected descendant that ignores SIGTERM', async () => {
			const { worker, records, exits, descendant, cwd } =
				await start('tree-stubborn');
			const began = Date.now();
			await worker.stop();
			const ended = Date.now();
			expect(records).toContainEqual({
				type: 'shutdown',
				aborted: true,
			});
			expect(exits[0].message).toBe('Worker exited (0)');
			expect(
				ended - Number(readFileSync(join(cwd, 'term'), 'utf8')),
			).toBeGreaterThanOrEqual(200);
			expect(ended - began).toBeLessThan(4000);
			expect(running(descendant!)).toBe(false);
		});

		it('bounds escalation when both owner and descendant ignore shutdown', async () => {
			const { worker, records, descendant } =
				await start('stubborn-owner');
			const began = Date.now();
			await worker.stop();
			expect(Date.now() - began).toBeLessThan(4000);
			expect(records).toContainEqual({
				type: 'shutdown',
				aborted: true,
			});
			expect(records).toContainEqual({
				type: 'signal',
				signal: 'SIGTERM',
			});
			expect(running(worker.pid!)).toBe(false);
			expect(running(descendant!)).toBe(false);
		});

		it('does not signal a closed worker or an independent process on late stop', async () => {
			const cwd = directory();
			const other = spawn(
				process.execPath,
				[fixture, 'descendant', 'stubborn', cwd],
				{
					stdio: 'ignore',
				},
			);
			independent.push(other);
			await expect
				.poll(() => {
					try {
						return readFileSync(join(cwd, 'ready'), 'utf8');
					} catch {
						return '';
					}
				})
				.toBe('ready');
			const { worker, exits } = await start('graceful');
			worker.write({ type: 'abort' });
			process.kill(worker.pid!, 'SIGTERM');
			await expect.poll(() => exits.length).toBe(1);
			const signal = vi.spyOn(process, 'kill');
			await worker.stop();
			expect(signal).not.toHaveBeenCalled();
			expect(running(other.pid!)).toBe(true);
		});
	},
);
