import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { is_lsp_binary_trusted, trust_lsp_binary } from './trust.js';

const files: string[] = [];

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
		for (const file of files.splice(0)) {
			rmSync(file, { force: true });
		}
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
});
