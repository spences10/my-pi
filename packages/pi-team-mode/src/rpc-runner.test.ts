import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RpcTeammate,
	build_rpc_teammate_args,
	create_rpc_teammate_env,
} from './rpc-runner.js';
import { TeamStore } from './store.js';

let root: string;
let store: TeamStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-rpc-'));
	store = new TeamStore(root);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('create_rpc_teammate_env', () => {
	it('keeps team vars and strips ambient secrets by default', () => {
		const env = create_rpc_teammate_env(
			{
				team_root: '/tmp/team-root',
				extension_path: '/tmp/team-extension.js',
			},
			'team-1',
			'alice',
			{
				PATH: '/bin',
				HOME: '/home/test',
				PI_CODING_AGENT_DIR: '/tmp/pi-agent',
				ANTHROPIC_API_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		);

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
			PI_CODING_AGENT_DIR: '/tmp/pi-agent',
			MY_PI_TEAM_MODE_ROOT: '/tmp/team-root',
			MY_PI_ACTIVE_TEAM_ID: 'team-1',
			MY_PI_TEAM_MEMBER: 'alice',
			MY_PI_TEAM_ROLE: 'teammate',
			MY_PI_TEAM_EXTENSION_PATH: '/tmp/team-extension.js',
		});
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('allows provider credentials only through team-mode allowlist', () => {
		const env = create_rpc_teammate_env(
			{
				team_root: '/tmp/team-root',
				extension_path: '/tmp/team-extension.js',
			},
			'team-1',
			'alice',
			{
				PATH: '/bin',
				ANTHROPIC_API_KEY: 'secret',
				MY_PI_TEAM_MODE_ENV_ALLOWLIST: 'ANTHROPIC_API_KEY',
			},
		);

		expect(env.ANTHROPIC_API_KEY).toBe('secret');
	});

	it('rejects unsafe teammate names before they reach env or paths', () => {
		expect(() =>
			create_rpc_teammate_env(
				{
					team_root: '/tmp/team-root',
					extension_path: '/tmp/team-extension.js',
				},
				'team-1',
				'../alice',
				{ PATH: '/bin' },
			),
		).toThrow(/member must contain/);
	});
});

function write_fake_rpc_child(
	options: {
		hang_get_state?: boolean;
		exit_after_follow_up?: boolean;
		file_name?: string;
		argv_path?: string;
	} = {},
): string {
	const path = join(root, options.file_name ?? 'fake-pi.js');
	writeFileSync(
		path,
		`#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const hang_get_state = ${JSON.stringify(options.hang_get_state ?? false)};
const exit_after_follow_up = ${JSON.stringify(options.exit_after_follow_up ?? false)};
const argv_path = ${JSON.stringify(options.argv_path)};
if (argv_path) fs.writeFileSync(argv_path, JSON.stringify(process.argv.slice(2)));
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'get_state') {
    if (!hang_get_state) send({ type: 'response', id: msg.id, success: true, data: { sessionFile: '/tmp/fake-session.jsonl' } });
  } else if (msg.type === 'set_session_name') {
    send({ type: 'response', id: msg.id, success: true });
  } else if (msg.type === 'prompt') {
    send({ type: 'response', id: msg.id, success: true });
    send({ type: 'agent_start' });
    setTimeout(() => send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }), 5);
    setTimeout(() => send({ type: 'agent_end' }), 10);
  } else if (msg.type === 'follow_up' || msg.type === 'steer' || msg.type === 'abort') {
    send({ type: 'response', id: msg.id, success: true });
    if (msg.type === 'follow_up' && exit_after_follow_up) setTimeout(() => process.exit(1), 5);
  }
});
process.on('SIGTERM', () => process.exit(0));
`,
	);
	chmodSync(path, 0o755);
	return path;
}

describe('build_rpc_teammate_args', () => {
	it('disables built-in my-pi team mode when injecting the team extension explicitly', () => {
		const args = build_rpc_teammate_args(
			{
				extension_path: '/tmp/team-extension.js',
				model: 'anthropic/claude-sonnet-4-5',
				thinking: 'high',
				system_prompt: 'Use the reviewer profile.',
				tools: ['read', 'bash'],
				skills: ['research'],
			},
			'/tmp/team-session',
			{
				prefix_args: ['/repo/dist/index.js'],
				disable_builtin_team_mode: true,
			},
		);

		expect(args).toEqual([
			'/repo/dist/index.js',
			'--mode',
			'rpc',
			'--session-dir',
			'/tmp/team-session',
			'--no-team-mode',
			'-e',
			'/tmp/team-extension.js',
			'--model',
			'anthropic/claude-sonnet-4-5',
			'--thinking',
			'high',
			'--append-system-prompt',
			'Use the reviewer profile.',
			'--tools',
			'read,bash',
			'--skill',
			'research',
		]);
		expect(
			args.filter((arg) => arg === '--no-team-mode'),
		).toHaveLength(1);
	});

	it('does not add my-pi-only flags for third-party RPC harness commands', () => {
		const args = build_rpc_teammate_args(
			{ extension_path: '/tmp/team-extension.js' },
			'/tmp/team-session',
			{ prefix_args: [], disable_builtin_team_mode: false },
		);

		expect(args).not.toContain('--no-team-mode');
		expect(args).toContain('-e');
	});
});

describe('RpcTeammate lifecycle', () => {
	it('waits for a busy teammate until agent_end arrives', async () => {
		const team = store.create_team({ cwd: '/repo', name: 'demo' });
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: '/repo',
			team_root: root,
			extension_path: '/tmp/team-extension.js',
		});

		(runner as any).mark_busy();
		const wait = runner.wait_for_idle(1_000);
		setTimeout(() => {
			(runner as any).handle_event({ type: 'agent_end' });
		}, 0);

		await expect(wait).resolves.toBeUndefined();
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'idle' });
	});

	it('marks a busy teammate blocked when an RPC request fails', () => {
		const team = store.create_team({ cwd: '/repo', name: 'demo' });
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: '/repo',
			team_root: root,
			extension_path: '/tmp/team-extension.js',
		});

		(runner as any).mark_busy();
		(runner as any).mark_blocked(new Error('RPC request timed out'));

		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'blocked' });
	});

	it('starts a my-pi-compatible child with built-in team mode disabled', async () => {
		const argv_path = join(root, 'child-argv.json');
		const fake_pi = write_fake_rpc_child({
			file_name: 'my-pi',
			argv_path,
		});
		const team = store.create_team({ cwd: root, name: 'demo' });
		const exits: string[] = [];
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: root,
			team_root: root,
			extension_path: join(root, 'team-extension.js'),
			pi_command: fake_pi,
			on_exit: (member) => exits.push(member),
		});

		await runner.start();
		const args = JSON.parse(readFileSync(argv_path, 'utf-8'));
		expect(args).toEqual(
			expect.arrayContaining([
				'--mode',
				'rpc',
				'--no-team-mode',
				'-e',
				join(root, 'team-extension.js'),
			]),
		);
		expect(
			args.filter((arg: string) => arg === '--no-team-mode'),
		).toHaveLength(1);

		await runner.shutdown('test done');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(exits).toContain('alice');
	});

	it('drives a real RPC child through start, prompt, wait, and shutdown', async () => {
		const fake_pi = write_fake_rpc_child();
		const team = store.create_team({ cwd: root, name: 'demo' });
		const exits: string[] = [];
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: root,
			team_root: root,
			extension_path: join(root, 'team-extension.js'),
			pi_command: fake_pi,
			on_exit: (member) => exits.push(member),
		});

		await runner.start();
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({
			status: 'idle',
			session_file: '/tmp/fake-session.jsonl',
		});

		await runner.prompt('do work');
		await runner.wait_for_idle(1_000);
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'idle' });

		await runner.shutdown('test done');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(exits).toContain('alice');
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'offline' });
	});

	it('restores delivered mailbox messages when a child exits before acknowledging them', async () => {
		const fake_pi = write_fake_rpc_child({
			exit_after_follow_up: true,
		});
		const team = store.create_team({ cwd: root, name: 'demo' });
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: root,
			team_root: root,
			extension_path: join(root, 'team-extension.js'),
			pi_command: fake_pi,
		});
		const message = store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'hello',
		});

		await runner.start();
		store.mark_messages_delivered(team.id, 'alice', [message.id]);
		await runner.follow_up('hello');
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(
			store.list_messages(team.id, 'alice')[0].delivered_at,
		).toBeUndefined();
		expect(
			store.list_messages(team.id, 'alice')[0].acknowledged_at,
		).toBeUndefined();
	});

	it('cleans up a real RPC child when startup handshake times out', async () => {
		const fake_pi = write_fake_rpc_child({ hang_get_state: true });
		const team = store.create_team({ cwd: root, name: 'demo' });
		const exits: string[] = [];
		const runner = new RpcTeammate(store, {
			team_id: team.id,
			member: 'alice',
			cwd: root,
			team_root: root,
			extension_path: join(root, 'team-extension.js'),
			pi_command: fake_pi,
			on_exit: (member) => exits.push(member),
		});
		const request = (runner as any).request.bind(runner);
		(runner as any).request = (
			command: Record<string, unknown>,
			timeout_ms: number,
		) =>
			request(
				command,
				command.type === 'get_state' ? 25 : timeout_ms,
			);

		await expect(runner.start()).rejects.toThrow(/timed out/);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(exits).toContain('alice');
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'offline' });
	});
});
