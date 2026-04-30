import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RpcTeammate,
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
				teamRoot: '/tmp/team-root',
				extensionPath: '/tmp/team-extension.js',
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
				teamRoot: '/tmp/team-root',
				extensionPath: '/tmp/team-extension.js',
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
					teamRoot: '/tmp/team-root',
					extensionPath: '/tmp/team-extension.js',
				},
				'team-1',
				'../alice',
				{ PATH: '/bin' },
			),
		).toThrow(/member must contain/);
	});
});

describe('RpcTeammate lifecycle', () => {
	it('waits for a busy teammate until agent_end arrives', async () => {
		const team = store.create_team({ cwd: '/repo', name: 'demo' });
		const runner = new RpcTeammate(store, {
			teamId: team.id,
			member: 'alice',
			cwd: '/repo',
			teamRoot: root,
			extensionPath: '/tmp/team-extension.js',
		});

		(runner as any).mark_busy();
		const wait = runner.waitForIdle(1_000);
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
			teamId: team.id,
			member: 'alice',
			cwd: '/repo',
			teamRoot: root,
			extensionPath: '/tmp/team-extension.js',
		});

		(runner as any).mark_busy();
		(runner as any).mark_blocked(new Error('RPC request timed out'));

		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'blocked' });
	});
});
