import { describe, expect, it } from 'vitest';
import { create_child_process_env } from './env.js';

describe('create_child_process_env', () => {
	it('keeps baseline env and removes secrets by default', () => {
		const env = create_child_process_env(
			{},
			{
				PATH: '/bin',
				HOME: '/home/test',
				LANG: 'en_GB.UTF-8',
				LC_ALL: 'en_GB.UTF-8',
				API_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		);

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
			LANG: 'en_GB.UTF-8',
			LC_ALL: 'en_GB.UTF-8',
		});
		expect(env.API_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('allows explicit MCP env and opt-in passthrough', () => {
		const env = create_child_process_env(
			{ API_KEY: 'explicit' },
			{
				PATH: '/bin',
				AWS_PROFILE: 'dev',
				MY_PI_MCP_ENV_ALLOWLIST: 'AWS_PROFILE',
				API_KEY: 'ambient',
			},
		);

		expect(env.API_KEY).toBe('explicit');
		expect(env.AWS_PROFILE).toBe('dev');
	});
});
