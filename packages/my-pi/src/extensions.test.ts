import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
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

	it('bundles the restored extensions and resolves skills without local configuration', async () => {
		temp_dir = mkdtempSync(join(tmpdir(), 'my-pi-fresh-'));
		process.env.PI_CODING_AGENT_DIR = temp_dir;
		for (const key of [
			'turn-timer',
			'session-name',
			'tool-guidance',
		]) {
			expect(
				EXTENSIONS.some((extension) => extension.key === key),
			).toBe(true);
			expect(is_enabled(key)).toBe(true);
			set_enabled(key, false);
			expect(is_enabled(key)).toBe(false);
		}
		const extension = EXTENSIONS.find(
			(item) => item.key === 'tool-guidance',
		)!;
		const factory = await extension.load();
		const events = new Map<string, Function>();
		await factory({
			on: (name: string, handler: Function) =>
				events.set(name, handler),
		} as unknown as ExtensionAPI);
		const resources = events.get('resources_discover')!();
		expect(resources.skillPaths).toHaveLength(1);
		expect(existsSync(resources.skillPaths[0])).toBe(true);
		for (const name of ['nopeek', 'omnisearch', 'sqlite']) {
			expect(
				readFileSync(
					join(resources.skillPaths[0], `my-pi-${name}`, 'SKILL.md'),
					'utf8',
				),
			).toContain(`name: my-pi-${name}`);
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
