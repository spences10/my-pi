import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	default_hooks_trust_store_path,
	is_hooks_config_trusted,
	trust_hooks_config,
} from './trust.js';

const files: string[] = [];
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

function trust_store_path(): string {
	const path = join(
		tmpdir(),
		`my-pi-hooks-trust-${process.pid}-${Date.now()}-${files.length}.json`,
	);
	files.push(path);
	return path;
}

describe('hook config trust', () => {
	afterEach(() => {
		if (original_agent_dir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = original_agent_dir;
		}
		for (const file of files.splice(0)) {
			rmSync(file, { force: true });
		}
	});

	it('uses PI_CODING_AGENT_DIR for the default trust store', () => {
		process.env.PI_CODING_AGENT_DIR = '/tmp/my-pi-hooks-agent';

		expect(default_hooks_trust_store_path()).toBe(
			'/tmp/my-pi-hooks-agent/trusted-hooks.json',
		);
	});

	it('trusts hook config by project directory and hash', () => {
		const store = trust_store_path();
		const project_dir = '/repo';

		expect(
			is_hooks_config_trusted(project_dir, 'hash-a', store),
		).toBe(false);

		trust_hooks_config(project_dir, 'hash-a', store);

		expect(
			is_hooks_config_trusted(project_dir, 'hash-a', store),
		).toBe(true);
		expect(
			is_hooks_config_trusted(project_dir, 'hash-b', store),
		).toBe(false);
		expect(readFileSync(store, 'utf8')).toContain('trusted_at');
	});
});
