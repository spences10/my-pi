import { describe, expect, it } from 'vitest';
import { create_rpc_teammate_env } from './env.js';

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
		expect(env).toMatchObject({
			MY_PI_OBSERVABILITY_POOL: 'team-1',
			MY_PI_OBSERVABILITY_TAG: 'team-mode,teammate:alice',
			MY_PI_OBSERVABILITY_NAME: 'alice',
		});
	});

	it('passes explicit observability routing to teammates', () => {
		const env = create_rpc_teammate_env(
			{
				team_root: '/tmp/team-root',
				extension_path: '/tmp/team-extension.js',
			},
			'team-1',
			'alice',
			{
				PATH: '/bin',
				MY_PI_OBSERVABILITY_URL: 'http://127.0.0.1:43190',
				MY_PI_OBSERVABILITY_TOKEN: 'token',
				MY_PI_OBSERVABILITY_POOL: 'demo',
				MY_PI_OBSERVABILITY_TAG: 'lead',
				MY_PI_OBSERVABILITY_RAW: 'true',
			},
		);

		expect(env).toMatchObject({
			MY_PI_OBSERVABILITY_URL: 'http://127.0.0.1:43190',
			MY_PI_OBSERVABILITY_TOKEN: 'token',
			MY_PI_OBSERVABILITY_POOL: 'demo',
			MY_PI_OBSERVABILITY_TAG: 'lead,team-mode,teammate:alice',
			MY_PI_OBSERVABILITY_NAME: 'alice',
			MY_PI_OBSERVABILITY_RAW: 'true',
		});
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
