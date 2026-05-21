import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const test_dirs = vi.hoisted(() => ({ agent_dir: '' }));

vi.mock('@earendil-works/pi-coding-agent', () => ({
	getAgentDir: () => test_dirs.agent_dir,
}));

import {
	get_settings_path,
	load_settings,
	save_settings,
} from './index.js';

function legacy_extensions_path(): string {
	return join(
		process.env.XDG_CONFIG_HOME!,
		'my-pi',
		'extensions.json',
	);
}

describe('settings', () => {
	beforeEach(() => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-settings-test-'));
		test_dirs.agent_dir = join(root, 'agent');
		process.env.XDG_CONFIG_HOME = join(root, 'xdg');
	});

	it('creates the canonical settings file when no config exists', () => {
		const settings = load_settings();

		expect(settings).toEqual({
			version: 1,
			extensions: { enabled: {} },
		});
		expect(get_settings_path()).toBe(
			join(test_dirs.agent_dir, 'my-pi-settings.json'),
		);
		expect(existsSync(get_settings_path())).toBe(true);
	});

	it('migrates legacy extension config into the canonical settings file', () => {
		const legacy_path = legacy_extensions_path();
		mkdirSync(join(legacy_path, '..'), { recursive: true });
		writeFileSync(
			legacy_path,
			JSON.stringify({ version: 1, enabled: { recall: false } }),
			{ flush: false },
		);

		const settings = load_settings();

		expect(settings.extensions.enabled.recall).toBe(false);
		expect(
			JSON.parse(readFileSync(get_settings_path(), 'utf-8')),
		).toMatchObject({ extensions: { enabled: { recall: false } } });
		expect(existsSync(legacy_path)).toBe(false);
	});

	it('saves updates only to the canonical settings file', () => {
		save_settings({
			version: 1,
			extensions: { enabled: { recall: false } },
		});

		expect(
			JSON.parse(readFileSync(get_settings_path(), 'utf-8')),
		).toMatchObject({ extensions: { enabled: { recall: false } } });
	});
});
