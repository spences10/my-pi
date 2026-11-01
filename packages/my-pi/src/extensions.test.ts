import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { EXTENSIONS } from './extensions.js';
import { is_enabled, set_enabled } from './settings.js';

const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
let temp_dir: string | undefined;

afterEach(() => {
	if (temp_dir) rmSync(temp_dir, { recursive: true, force: true });
	temp_dir = undefined;
	if (original_agent_dir === undefined)
		delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
});

describe('extensions', () => {
	it('has unique keys', () => {
		const keys = EXTENSIONS.map((extension) => extension.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('loads every extension factory', async () => {
		for (const extension of EXTENSIONS) {
			expect(await extension.load(), extension.key).toBeTypeOf(
				'function',
			);
		}
	});

	it('saves enabled state, defaulting to enabled', () => {
		temp_dir = mkdtempSync(join(tmpdir(), 'my-pi-settings-'));
		process.env.PI_CODING_AGENT_DIR = temp_dir;

		expect(is_enabled('starfield')).toBe(true);
		set_enabled('starfield', false);
		expect(is_enabled('starfield')).toBe(false);
		expect(is_enabled('lsp')).toBe(true);
		set_enabled('starfield', true);
		expect(is_enabled('starfield')).toBe(true);
	});
});
