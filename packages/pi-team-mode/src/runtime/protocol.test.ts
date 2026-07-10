import { describe, expect, it } from 'vitest';
import { parse_runtime_request } from './protocol.js';
import {
	decode_runtime_host_config,
	encode_runtime_host_config,
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
			initial_prompt: 'quoted "prompt"\nnext line',
		};
		expect(decode_runtime_host_config(encode_runtime_host_config(config))).toEqual(config);
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
