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
				OPENAI_API_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		);

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
			LANG: 'en_GB.UTF-8',
			LC_ALL: 'en_GB.UTF-8',
		});
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('supports LSP-specific passthrough allowlist', () => {
		const env = create_child_process_env(
			{},
			{
				PATH: '/bin',
				RUSTUP_HOME: '/rustup',
				MY_PI_LSP_ENV_ALLOWLIST: 'RUSTUP_HOME',
			},
		);

		expect(env.RUSTUP_HOME).toBe('/rustup');
	});
});
