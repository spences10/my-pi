import { describe, expect, it } from 'vitest';
import { create_rpc_teammate_env } from './rpc-runner.js';

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
				ANTHROPIC_API_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		);

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
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
});
