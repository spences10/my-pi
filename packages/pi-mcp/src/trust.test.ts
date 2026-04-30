import { readFileSync, rmSync, writeFileSync } from 'node:fs';
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
		const stored = readFileSync(store, 'utf8');
		expect(stored).toContain('trusted_at');
		expect(stored).toContain('mcp-config');
	});

	it('recognizes legacy MCP trust-store entries during migration', () => {
		const store = trust_store_path();
		const path = '/repo/mcp.json';
		writeFileSync(
			store,
			JSON.stringify({
				[path]: {
					path,
					hash: 'hash-a',
					trusted_at: '2026-04-30T00:00:00.000Z',
				},
			}),
		);

		expect(is_project_mcp_config_trusted(path, 'hash-a', store)).toBe(
			true,
		);
		expect(is_project_mcp_config_trusted(path, 'hash-b', store)).toBe(
			false,
		);
	});
});
