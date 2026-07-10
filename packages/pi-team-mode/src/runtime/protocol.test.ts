import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse_runtime_request } from './protocol.js';
import {
	consume_runtime_host_config,
	decode_runtime_host_config,
	encode_runtime_host_config,
	runtime_host_args,
	write_runtime_host_config,
} from './supervisor.js';

describe('persistent runtime protocol', () => {
	it('round trips detached host configuration without shell interpolation', () => {
		const config = {
			db_path: '/tmp/db with spaces.sqlite',
			session_id: 'session',
			session_file: '/tmp/session.jsonl',
			cwd: '/tmp/project',
			runtime_id: 'runtime',
			generation: 2,
			endpoint: '/tmp/runtime.sock',
			extension_path: '/tmp/pi-team-mode.js',
			member: 'worker',
			role: 'peer' as const,
		};
		expect(decode_runtime_host_config(encode_runtime_host_config(config))).toEqual(config);
	});

	it('passes only a 0600 config path to the host and removes it on consume', () => {
		const initial_prompt = 'private initial task text';
		const config = {
			db_path: '/tmp/db.sqlite',
			session_id: 'session',
			session_file: '/tmp/session.jsonl',
			cwd: '/tmp/project',
			runtime_id: 'runtime',
			generation: 1,
			endpoint: '/tmp/runtime.sock',
			extension_path: '/tmp/pi-team-mode.js',
		};
		const config_path = write_runtime_host_config(config);
		expect(statSync(config_path).mode & 0o777).toBe(0o600);
		expect(
			runtime_host_args('/tmp/host.js', config_path, 'runtime'),
		).not.toContain(initial_prompt);
		expect(consume_runtime_host_config(config_path)).toEqual(config);
		expect(existsSync(config_path)).toBe(false);
	});

	it('rejects unsupported versions and empty native prompts', () => {
		expect(() => parse_runtime_request({ id: '1', version: 2, method: 'status' })).toThrow(
			'Unsupported runtime protocol version',
		);
		expect(() =>
			parse_runtime_request({ id: '1', version: 1, method: 'prompt', message: ' ' }),
		).toThrow('Runtime message is required');
	});
});
