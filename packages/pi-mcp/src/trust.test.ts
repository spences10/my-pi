import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	default_mcp_trust_store_path,
	is_project_mcp_config_trusted,
	trust_project_mcp_config,
} from './trust.js';

const files: string[] = [];
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

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
		process.env.PI_CODING_AGENT_DIR = '/tmp/my-pi-mcp-agent';

		expect(default_mcp_trust_store_path()).toBe(
			'/tmp/my-pi-mcp-agent/trusted-mcp-projects.json',
		);
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
