import {
	spawn,
	type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle_team_command } from './index.js';
import { RpcTeammate } from './rpc-runner.js';
import { TeamStore } from './store.js';

const repo_root = fileURLToPath(new URL('../../..', import.meta.url));
const my_pi_cli = join(repo_root, 'dist/index.js');
const team_extension = join(
	repo_root,
	'packages/pi-team-mode/dist/index.js',
);

let root: string;
let store: TeamStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-e2e-'));
	store = new TeamStore(join(root, 'teams'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

interface RpcWaiter {
	predicate: (event: any) => boolean;
	resolve: (event: any) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

class RpcChild {
	readonly proc: ChildProcessWithoutNullStreams;
	private readonly decoder = new StringDecoder('utf8');
	private buffer = '';
	private next_id = 1;
	private stderr = '';
	private readonly responses = new Map<
		string,
		{
			resolve: (value: any) => void;
			reject: (error: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();
	private readonly events: any[] = [];
	private readonly waiters: RpcWaiter[] = [];

	constructor(args: string[], env: NodeJS.ProcessEnv = {}) {
		this.proc = spawn(process.execPath, [my_pi_cli, ...args], {
			cwd: root,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				USERPROFILE: process.env.USERPROFILE,
				TMPDIR: process.env.TMPDIR,
				TEMP: process.env.TEMP,
				PI_CODING_AGENT_DIR: join(root, 'agent'),
				MY_PI_TEAM_MODE_ROOT: store.root,
				MY_PI_TEAM_AUTO_INJECT_MESSAGES: '0',
				MY_PI_PROJECT_SKILLS: 'skip',
				MY_PI_TEAM_PROFILES_PROJECT: 'skip',
				...env,
			},
		});
		this.proc.stdout.on('data', (chunk) => this.handle_stdout(chunk));
		this.proc.stderr.on('data', (chunk) => {
			this.stderr += chunk.toString('utf8');
		});
		this.proc.on('close', (code, signal) => {
			const error = new Error(
				`RPC child exited (${code ?? signal ?? 'unknown'}): ${this.stderr}`,
			);
			for (const pending of this.responses.values()) {
				clearTimeout(pending.timer);
				pending.reject(error);
			}
			this.responses.clear();
			for (const waiter of this.waiters.splice(0)) {
				clearTimeout(waiter.timer);
				waiter.reject(error);
			}
		});
	}

	request(type: string, payload: Record<string, unknown> = {}) {
		const id = `e2e-${this.next_id++}`;
		this.proc.stdin.write(
			JSON.stringify({ id, type, ...payload }) + '\n',
		);
		return new Promise<any>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.responses.delete(id);
				reject(
					new Error(`Timed out waiting for ${type}: ${this.stderr}`),
				);
			}, 10_000);
			this.responses.set(id, { resolve, reject, timer });
		});
	}

	wait_for(
		predicate: (event: any) => boolean,
		timeout_ms = 10_000,
	): Promise<any> {
		const existing = this.events.find(predicate);
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve, reject) => {
			const waiter: RpcWaiter = {
				predicate,
				resolve,
				reject,
				timer: setTimeout(() => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(
						new Error(
							`Timed out waiting for RPC event: ${this.stderr}`,
						),
					);
				}, timeout_ms),
			};
			this.waiters.push(waiter);
		});
	}

	async close(): Promise<void> {
		if (this.proc.exitCode !== null) return;
		this.proc.kill('SIGTERM');
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
	}

	private handle_stdout(chunk: Buffer): void {
		this.buffer += this.decoder.write(chunk);
		while (true) {
			const newline = this.buffer.indexOf('\n');
			if (newline === -1) return;
			const line = this.buffer.slice(0, newline).replace(/\r$/, '');
			this.buffer = this.buffer.slice(newline + 1);
			if (line.trim()) this.handle_line(line);
		}
	}

	private handle_line(line: string): void {
		const event = JSON.parse(line);
		if (event.type === 'response' && event.id) {
			const pending = this.responses.get(event.id);
			if (pending) {
				this.responses.delete(event.id);
				clearTimeout(pending.timer);
				if (event.success === false) {
					pending.reject(
						new Error(event.error ?? 'RPC request failed'),
					);
				} else {
					pending.resolve(event);
				}
				return;
			}
		}
		this.events.push(event);
		for (
			let index = this.waiters.length - 1;
			index >= 0;
			index -= 1
		) {
			const waiter = this.waiters[index]!;
			if (!waiter.predicate(event)) continue;
			this.waiters.splice(index, 1);
			clearTimeout(waiter.timer);
			waiter.resolve(event);
		}
	}
}

function require_built_cli(): void {
	expect(existsSync(my_pi_cli), `${my_pi_cli} must exist`).toBe(true);
	expect(
		existsSync(team_extension),
		`${team_extension} must exist`,
	).toBe(true);
}

function write_my_pi_wrapper(argv_path: string): string {
	const wrapper = join(root, 'my-pi');
	writeFileSync(
		wrapper,
		`#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
fs.writeFileSync(${JSON.stringify(argv_path)}, JSON.stringify(process.argv.slice(2)));
const child = spawn(process.execPath, [${JSON.stringify(my_pi_cli)}, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`,
	);
	chmodSync(wrapper, 0o755);
	return wrapper;
}

describe('team mode RPC integration', () => {
	it('spawns a real my-pi RPC teammate with built-in team mode disabled', async () => {
		require_built_cli();
		const argv_path = join(root, 'argv.json');
		const my_pi = write_my_pi_wrapper(argv_path);
		const team = store.create_team({ cwd: root, name: 'e2e' });
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: root,
			team_root: store.root,
			extension_path: team_extension,
			pi_command: my_pi,
		});

		await runner.start();
		const args = JSON.parse(
			readFileSync(argv_path, 'utf8'),
		) as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				'--mode',
				'rpc',
				'--no-team-mode',
				'-e',
				team_extension,
			]),
		);
		expect(
			args.filter((arg) => arg === '--no-team-mode'),
		).toHaveLength(1);
		expect(store.list_members(team.id)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'alice',
					role: 'teammate',
					session_file: expect.any(String),
				}),
			]),
		);

		await runner.shutdown('test complete');
	});

	it('covers commands, mailbox visibility, nested-spawn blocking, and orphan recovery through a real RPC child', async () => {
		require_built_cli();
		const team = store.create_team({ cwd: root, name: 'e2e' });
		store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'hello from lead',
			urgent: true,
		});
		const child = new RpcChild(
			[
				'--mode',
				'rpc',
				'--agent-dir',
				join(root, 'agent'),
				'--session-dir',
				join(root, 'sessions'),
			],
			{
				MY_PI_ACTIVE_TEAM_ID: team.id,
				MY_PI_TEAM_MEMBER: 'alice',
				MY_PI_TEAM_ROLE: 'teammate',
			},
		);
		try {
			await child.request('get_state');
			const commands = await child.request('get_commands');
			expect(
				commands.data.commands.filter(
					(command: { name: string }) => command.name === 'team',
				),
			).toHaveLength(1);

			await child.request('prompt', { message: '/team inbox alice' });
			await child.wait_for(
				(event) =>
					event.type === 'extension_ui_request' &&
					event.method === 'notify' &&
					event.message.includes('hello from lead') &&
					event.message.includes('unread'),
			);

			await child.request('prompt', { message: '/team spawn bob' });
			await child.wait_for(
				(event) =>
					event.type === 'extension_ui_request' &&
					event.method === 'notify' &&
					event.message.includes(
						'Only team leads can spawn teammates',
					),
			);

			expect(store.get_status(team.id).members).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'alice',
						status: 'running_orphaned',
					}),
				]),
			);

			const notifications: string[] = [];
			await handle_team_command(
				'shutdown alice',
				{
					cwd: root,
					hasUI: false,
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				store,
				new Map(),
				() => team.id,
				() => undefined,
				'lead',
			);
			expect(notifications.join('\n')).toContain(
				'Terminated orphaned teammate alice',
			);
			expect(store.list_members(team.id)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'alice',
						status: 'offline',
					}),
				]),
			);
		} finally {
			await child.close();
		}
	}, 30_000);
});
