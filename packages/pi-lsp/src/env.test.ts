import { describe, expect, it } from 'vite-plus/test';
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
				LC_MESSAGES: 'en_GB.UTF-8',
				PI_CODING_AGENT_DIR: '/tmp/pi-agent',
				PI_SESSION_ID: 'stale-session',
				PI_SESSION_FILE: '/tmp/stale-session.jsonl',
				PI_PROVIDER: 'stale-provider',
				PI_MODEL: 'stale-model',
				PI_REASONING_LEVEL: 'stale-level',
				ANTHROPIC_API_KEY: 'synthetic',
				OPENAI_API_KEY: 'synthetic',
				AWS_SECRET_ACCESS_KEY: 'synthetic',
				DATABASE_URL: 'synthetic',
				NODE_OPTIONS: '--inspect',
				RUSTUP_HOME: '/rustup',
				UNSET: undefined,
			},
		);

		expect(env).toEqual({
			PATH: '/bin',
			HOME: '/home/test',
			LANG: 'en_GB.UTF-8',
			LC_ALL: 'en_GB.UTF-8',
			LC_MESSAGES: 'en_GB.UTF-8',
			PI_CODING_AGENT_DIR: '/tmp/pi-agent',
		});
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

	it('combines both allowlists, trimming empty and duplicate entries', () => {
		const source_env = Object.freeze({
			PATH: '/bin',
			CARGO_HOME: '/cargo',
			JAVA_HOME: '/java',
			RUSTUP_HOME: '/rustup',
			MY_PI_CHILD_ENV_ALLOWLIST: ' CARGO_HOME, , JAVA_HOME, MISSING ',
			MY_PI_LSP_ENV_ALLOWLIST: ' RUSTUP_HOME, CARGO_HOME, ',
		});

		expect(create_child_process_env({}, source_env)).toEqual({
			PATH: '/bin',
			CARGO_HOME: '/cargo',
			JAVA_HOME: '/java',
			RUSTUP_HOME: '/rustup',
		});
	});

	it('supports explicit overrides without modifying the source environment', () => {
		const source_env = Object.freeze({
			PATH: '/bin',
			OPENAI_API_KEY: 'synthetic-ambient',
		});

		expect(
			create_child_process_env(
				{ PATH: '/custom/bin', OPENAI_API_KEY: 'synthetic-explicit' },
				source_env,
			),
		).toEqual({
			PATH: '/custom/bin',
			OPENAI_API_KEY: 'synthetic-explicit',
		});
	});

	it('allows explicitly opted-in credentials and session metadata', () => {
		expect(
			create_child_process_env(
				{},
				{
					OPENAI_API_KEY: 'synthetic',
					PI_SESSION_ID: 'explicit-session',
					MY_PI_CHILD_ENV_ALLOWLIST: 'OPENAI_API_KEY',
					MY_PI_LSP_ENV_ALLOWLIST: 'PI_SESSION_ID',
				},
			),
		).toEqual({
			OPENAI_API_KEY: 'synthetic',
			PI_SESSION_ID: 'explicit-session',
		});
	});

	it('does not honor the retired team-mode profile allowlist', () => {
		expect(
			create_child_process_env(
				{},
				{
					OPENAI_API_KEY: 'synthetic',
					MY_PI_TEAM_MODE_ENV_ALLOWLIST: 'OPENAI_API_KEY',
				},
			),
		).toEqual({});
	});
});
