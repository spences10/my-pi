import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	is_project_mcp_config_trusted,
	trust_project_mcp_config,
} from './trust.js';

const files: string[] = [];

function trust_store_path(): string {
	const path = join(
		tmpdir(),
		`my-pi-mcp-trust-${process.pid}-${Date.now()}-${files.length}.json`,
	);
	files.push(path);
	return path;
}

describe('project MCP config trust', () => {
	afterEach(() => {
		for (const file of files.splice(0)) {
			rmSync(file, { force: true });
		}
	});

	it('trusts a project config by path and hash', () => {
		const store = trust_store_path();
		const path = '/repo/mcp.json';

		expect(is_project_mcp_config_trusted(path, 'hash-a', store)).toBe(
			false,
		);

		trust_project_mcp_config(path, 'hash-a', store);

		expect(is_project_mcp_config_trusted(path, 'hash-a', store)).toBe(
			true,
		);
		expect(is_project_mcp_config_trusted(path, 'hash-b', store)).toBe(
			false,
		);
		expect(readFileSync(store, 'utf8')).toContain('trusted_at');
	});
});
