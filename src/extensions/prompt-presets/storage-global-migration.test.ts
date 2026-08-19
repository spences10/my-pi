import type { MyPiSettingsFile } from '@spences10/pi-settings';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

const mocked = vi.hoisted(() => ({
	root: '',
	settings: { version: 1 } as MyPiSettingsFile,
}));

vi.mock('@spences10/pi-settings', () => ({
	get_settings_path: () => join(mocked.root, 'my-pi-settings.json'),
	read_settings: () => mocked.settings,
	write_settings: (next: MyPiSettingsFile) => {
		mocked.settings = next;
	},
}));

vi.mock(
	'@earendil-works/pi-coding-agent',
	async (import_original) => {
		const original =
			await import_original<
				typeof import('@earendil-works/pi-coding-agent')
			>();
		return {
			...original,
			getAgentDir: () => mocked.root,
		};
	},
);

import {
	migrate_legacy_prompt_presets,
	save_prompt_preset_file,
} from './storage.js';

describe('global legacy prompt preset migration', () => {
	beforeEach(() => {
		mocked.root = mkdtempSync(
			join(tmpdir(), 'my-pi-global-migration-'),
		);
		mocked.settings = { version: 1 };
	});

	afterEach(() => {
		rmSync(mocked.root, { recursive: true, force: true });
	});

	it('preserves state, collisions, and unsafe names while remaining idempotent', () => {
		const state = {
			version: 1,
			projects: {
				'/project': { base_name: 'safe', layer_names: ['a/b'] },
			},
		};
		mocked.settings = {
			version: 1,
			promptPresets: {
				global: {
					safe: { instructions: 'Move globally.' },
					'a/b': { instructions: 'Preserve unsafe.' },
					collision: { instructions: 'Preserve collision.' },
				},
				state,
			},
		};
		const presets_dir = join(mocked.root, 'presets');
		save_prompt_preset_file(presets_dir, 'collision', {
			instructions: 'Existing Markdown.',
		});

		const first = migrate_legacy_prompt_presets('/project', 'global');
		expect(first.written).toEqual([join(presets_dir, 'safe.md')]);
		expect(first.remaining_legacy).toBe(2);
		expect(mocked.settings.promptPresets?.state).toEqual(state);
		expect(mocked.settings.promptPresets?.global).toEqual({
			'a/b': { instructions: 'Preserve unsafe.' },
			collision: { instructions: 'Preserve collision.' },
		});
		expect(
			readFileSync(join(presets_dir, 'collision.md'), 'utf-8'),
		).toContain('Existing Markdown.');

		const second = migrate_legacy_prompt_presets(
			'/project',
			'global',
		);
		expect(second.written).toEqual([]);
		expect(second.remaining_legacy).toBe(2);
		expect(mocked.settings.promptPresets?.state).toEqual(state);
	});
});
