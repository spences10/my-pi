import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	is_hooks_config_trusted,
	trust_hooks_config,
} from './trust.js';

const files: string[] = [];

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
		for (const file of files.splice(0)) {
			rmSync(file, { force: true });
		}
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
