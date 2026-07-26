import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
	create_child_process_env,
	create_hook_session_env,
} from './env.js';

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

	it('derives fresh Pi metadata from the current extension context', () => {
		const env = create_hook_session_env({
			sessionManager: {
				getSessionId: () => 'session-current',
				getSessionFile: () => '/tmp/session-current.jsonl',
			},
			model: { provider: 'anthropic', id: 'claude-current' },
			thinkingLevel: 'high',
		} as unknown as ExtensionContext);

		expect(env).toEqual({
			PI_SESSION_ID: 'session-current',
			PI_SESSION_FILE: '/tmp/session-current.jsonl',
			PI_PROVIDER: 'anthropic',
			PI_MODEL: 'claude-current',
			PI_REASONING_LEVEL: 'high',
		});
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
