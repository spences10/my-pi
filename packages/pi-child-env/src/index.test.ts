import { describe, expect, it } from 'vitest';
import {
	create_child_process_env,
	create_pi_session_env,
} from './index.js';

describe('create_child_process_env', () => {
	it('keeps baseline env and strips common secrets by default', () => {
		const env = create_child_process_env({
			source_env: {
				PATH: '/bin',
				HOME: '/home/test',
				LANG: 'en_GB.UTF-8',
				LC_ALL: 'en_GB.UTF-8',
				PI_CODING_AGENT_DIR: '/tmp/pi-agent',
				PI_SESSION_ID: 'stale-session',
				PI_SESSION_FILE: '/tmp/stale-session.jsonl',
				PI_PROVIDER: 'stale-provider',
				PI_MODEL: 'stale-model',
				PI_REASONING_LEVEL: 'stale-level',
				ANTHROPIC_API_KEY: 'secret',
				OPENAI_API_KEY: 'secret',
				AWS_SECRET_ACCESS_KEY: 'secret',
				DATABASE_URL: 'postgres://secret',
			},
		});

		expect(env).toMatchObject({
			PATH: '/bin',
			HOME: '/home/test',
			LANG: 'en_GB.UTF-8',
			LC_ALL: 'en_GB.UTF-8',
			PI_CODING_AGENT_DIR: '/tmp/pi-agent',
		});
		expect(env.PI_SESSION_ID).toBeUndefined();
		expect(env.PI_SESSION_FILE).toBeUndefined();
		expect(env.PI_PROVIDER).toBeUndefined();
		expect(env.PI_MODEL).toBeUndefined();
		expect(env.PI_REASONING_LEVEL).toBeUndefined();
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('creates explicit current-session metadata without retaining stale values', () => {
		expect(
			create_pi_session_env({
				session_id: 'session-1',
				session_file: '/tmp/session-1.jsonl',
				provider: 'anthropic',
				model: 'claude',
				reasoning_level: 'high',
			}),
		).toEqual({
			PI_SESSION_ID: 'session-1',
			PI_SESSION_FILE: '/tmp/session-1.jsonl',
			PI_PROVIDER: 'anthropic',
			PI_MODEL: 'claude',
			PI_REASONING_LEVEL: 'high',
		});
		expect(
			create_pi_session_env({
				session_id: 'session-2',
				provider: 'openai',
			}),
		).toEqual({
			PI_SESSION_ID: 'session-2',
			PI_PROVIDER: 'openai',
		});
	});

	it('honors shared allowlist entries', () => {
		const env = create_child_process_env({
			source_env: {
				PATH: '/bin',
				AWS_PROFILE: 'dev',
				MY_PI_CHILD_ENV_ALLOWLIST: ' AWS_PROFILE, , ',
			},
		});

		expect(env.AWS_PROFILE).toBe('dev');
	});

	it('honors profile-specific allowlist entries', () => {
		const env = create_child_process_env({
			profile: 'team-mode',
			source_env: {
				PATH: '/bin',
				ANTHROPIC_API_KEY: 'secret',
				MY_PI_TEAM_MODE_ENV_ALLOWLIST: 'ANTHROPIC_API_KEY',
			},
		});

		expect(env.ANTHROPIC_API_KEY).toBe('secret');
	});

	it('supports explicit env overrides and custom allowlist env keys', () => {
		const env = create_child_process_env({
			explicit_env: {
				API_KEY: 'explicit',
				EMPTY: undefined,
			},
			extra_allowed_keys: ['CUSTOM_HOME'],
			extra_allowlist_env_keys: ['CUSTOM_ALLOWLIST'],
			source_env: {
				PATH: '/bin',
				CUSTOM_HOME: '/custom',
				EXTRA: 'value',
				API_KEY: 'ambient',
				CUSTOM_ALLOWLIST: 'EXTRA',
			},
		});

		expect(env.API_KEY).toBe('explicit');
		expect(env.EMPTY).toBeUndefined();
		expect(env.CUSTOM_HOME).toBe('/custom');
		expect(env.EXTRA).toBe('value');
	});
});
