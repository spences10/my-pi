import { describe, expect, it } from 'vitest';
import { create_child_process_env } from './env.js';

describe('create_child_process_env', () => {
	it('keeps baseline env and removes secrets by default', () => {
		const env = create_child_process_env(
			{ CLAUDE_PROJECT_DIR: '/repo' },
			{
				PATH: '/bin',
				HOME: '/home/test',
				LANG: 'en_GB.UTF-8',
				LC_ALL: 'en_GB.UTF-8',
				ANTHROPIC_API_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		);

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
			LANG: 'en_GB.UTF-8',
			LC_ALL: 'en_GB.UTF-8',
			CLAUDE_PROJECT_DIR: '/repo',
		});
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('supports hook-specific passthrough allowlist', () => {
		const env = create_child_process_env(
			{},
			{
				PATH: '/bin',
				CUSTOM_HOOK_ENV: 'value',
				MY_PI_HOOKS_ENV_ALLOWLIST: 'CUSTOM_HOOK_ENV',
			},
		);

		expect(env.CUSTOM_HOOK_ENV).toBe('value');
	});
});
