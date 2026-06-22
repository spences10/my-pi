import { describe, expect, it } from 'vitest';
import {
	is_resource_enabled,
	MY_PI_RUNTIME_MODE_ENV,
	PI_AGENT_DIR_ENV,
	restore_env,
	resolve_agent_dir,
	snapshot_env,
	wrap_runtime_env_restore,
} from './env.js';

describe('api env helpers', () => {
	it('snapshots and restores selected environment keys', () => {
		const env: NodeJS.ProcessEnv = {
			[PI_AGENT_DIR_ENV]: '/agent-a',
			[MY_PI_RUNTIME_MODE_ENV]: 'json',
			OTHER: 'kept',
		};
		const snapshot = snapshot_env(env, [
			PI_AGENT_DIR_ENV,
			MY_PI_RUNTIME_MODE_ENV,
			'MISSING',
		]);

		env[PI_AGENT_DIR_ENV] = '/agent-b';
		delete env[MY_PI_RUNTIME_MODE_ENV];
		env.MISSING = 'created';

		restore_env(env, snapshot);

		expect(env[PI_AGENT_DIR_ENV]).toBe('/agent-a');
		expect(env[MY_PI_RUNTIME_MODE_ENV]).toBe('json');
		expect(env.MISSING).toBeUndefined();
		expect(env.OTHER).toBe('kept');
	});

	it('restores runtime env exactly once when disposed', async () => {
		let disposed = 0;
		let restored = 0;
		const runtime = wrap_runtime_env_restore(
			{ dispose: async () => void disposed++ },
			() => void restored++,
		);

		await runtime.dispose();
		await runtime.dispose();

		expect(disposed).toBe(2);
		expect(restored).toBe(1);
	});

	it('parses resource enable flags conservatively', () => {
		expect(is_resource_enabled(undefined)).toBe(true);
		expect(is_resource_enabled(' yes ')).toBe(true);
		expect(is_resource_enabled('0')).toBe(false);
		expect(is_resource_enabled('FALSE')).toBe(false);
		expect(is_resource_enabled('skip')).toBe(false);
	});

	it('resolves relative agent dirs against the requested cwd', () => {
		expect(resolve_agent_dir('/repo', '.agent')).toBe('/repo/.agent');
	});
});
