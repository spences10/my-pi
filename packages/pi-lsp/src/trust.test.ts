import {
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	default_lsp_trust_store_path,
	is_lsp_binary_trusted,
	trust_lsp_binary,
} from './trust.js';

const files: string[] = [];
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

function trust_store_path(): string {
	const path = join(
		tmpdir(),
		`my-pi-lsp-trust-${process.pid}-${Date.now()}-${files.length}.json`,
	);
	files.push(path);
	return path;
}

describe('LSP binary trust', () => {
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
		process.env.PI_CODING_AGENT_DIR = '/tmp/my-pi-lsp-agent';

		expect(default_lsp_trust_store_path()).toBe(
			'/tmp/my-pi-lsp-agent/trusted-lsp-binaries.json',
		);
	});

	it('trusts a project-local language server binary by path', () => {
		const store = trust_store_path();
		const binary_path = '/repo/node_modules/.bin/svelteserver';

		expect(is_lsp_binary_trusted(binary_path, store)).toBe(false);

		trust_lsp_binary(binary_path, store);

		expect(is_lsp_binary_trusted(binary_path, store)).toBe(true);
		expect(is_lsp_binary_trusted(`${binary_path}-other`, store)).toBe(
			false,
		);
		expect(readFileSync(store, 'utf8')).toContain('trusted_at');
	});

	it('recognizes legacy path-only trust store entries', () => {
		const store = trust_store_path();
		const binary_path = '/repo/node_modules/.bin/svelteserver';
		mkdirSync(join(store, '..'), { recursive: true });
		writeFileSync(
			store,
			JSON.stringify({
				[binary_path]: {
					binary_path,
					trusted_at: '2026-04-30T00:00:00.000Z',
				},
			}),
		);

		expect(is_lsp_binary_trusted(binary_path, store)).toBe(true);
		expect(is_lsp_binary_trusted(`${binary_path}-other`, store)).toBe(
			false,
		);
	});
});
