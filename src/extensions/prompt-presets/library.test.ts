import type { MyPiSettingsFile } from '@spences10/pi-settings';
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
	fail_write: false,
}));

vi.mock('@spences10/pi-settings', () => ({
	get_settings_path: () => join(mocked.root, 'my-pi-settings.json'),
	read_settings: () => mocked.settings,
	write_settings: (next: MyPiSettingsFile) => {
		if (mocked.fail_write)
			throw new Error('simulated settings failure');
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
		return { ...original, getAgentDir: () => mocked.root };
	},
);

import {
	copy_prompt_preset,
	create_prompt_preset,
	delete_prompt_preset,
	get_delete_prompt_preset_confirmation,
	PromptPresetLibraryError,
	reload_prompt_preset_library,
	rename_prompt_preset,
	reset_prompt_preset_override,
	validate_prompt_preset_name,
} from './library.js';
import {
	load_persisted_prompt_state,
	save_persisted_prompt_state,
	save_project_prompt_presets,
} from './storage.js';

describe('prompt preset library', () => {
	let cwd: string;

	beforeEach(() => {
		mocked.root = mkdtempSync(join(tmpdir(), 'my-pi-library-agent-'));
		cwd = mkdtempSync(join(tmpdir(), 'my-pi-library-project-'));
		mocked.settings = { version: 1 };
		mocked.fail_write = false;
		delete process.env.MY_PI_PROMPT_PRESETS_PROJECT;
	});

	afterEach(() => {
		rmSync(mocked.root, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
		delete process.env.MY_PI_PROMPT_PRESETS_PROJECT;
	});

	it('uses strict portable names, scopes, and kinds', () => {
		for (const name of [
			'a/b',
			'a:b',
			'.hidden',
			'trailing.',
			' spaced',
			'CON',
			'nul.txt',
			'Com1.log',
			'LPT9',
		]) {
			expect(() => validate_prompt_preset_name(name)).toThrow(
				PromptPresetLibraryError,
			);
		}
		expect(() =>
			create_prompt_preset(cwd, 'other' as 'project', 'valid', {
				instructions: 'x',
			}),
		).toThrowError(
			expect.objectContaining({ code: 'invalid-scope' }),
		);
		expect(() =>
			create_prompt_preset(cwd, 'project', 'valid', {
				kind: 'other' as 'base',
				instructions: 'x',
			}),
		).toThrowError(expect.objectContaining({ code: 'invalid-kind' }));
		expect(() =>
			create_prompt_preset(cwd, 'project', 'empty', {
				instructions: '   ',
			}),
		).toThrowError(
			expect.objectContaining({ code: 'invalid-instructions' }),
		);
	});

	it('creates in both scopes and rejects portable filename collisions', () => {
		const project = create_prompt_preset(cwd, 'project', 'custom', {
			kind: 'layer',
			instructions: 'Project custom.',
		});
		const global = create_prompt_preset(
			cwd,
			'global',
			'global-custom',
			{
				instructions: 'Global custom.',
			},
		);
		expect(project.preset?.origin).toBe('project-markdown');
		expect(global.preset?.origin).toBe('global-markdown');
		expect(() =>
			create_prompt_preset(cwd, 'project', 'CUSTOM', {
				instructions: 'Collision.',
			}),
		).toThrowError(expect.objectContaining({ code: 'collision' }));
	});

	it('copies built-in and custom presets into one target scope', () => {
		const builtin = copy_prompt_preset(
			cwd,
			'terse',
			'builtin',
			'project',
			'terse-copy',
		);
		expect(builtin.preset).toMatchObject({
			name: 'terse-copy',
			origin: 'project-markdown',
		});
		create_prompt_preset(cwd, 'project', 'local', {
			instructions: 'Local.',
		});
		const custom = copy_prompt_preset(
			cwd,
			'local',
			'project',
			'global',
			'shared',
		);
		expect(custom.preset).toMatchObject({
			name: 'shared',
			origin: 'global-markdown',
			instructions: 'Local.',
		});

		create_prompt_preset(cwd, 'global', 'shadowed', {
			instructions: 'Global definition.',
		});
		create_prompt_preset(cwd, 'project', 'shadowed', {
			instructions: 'Project definition.',
		});
		const selected_global = copy_prompt_preset(
			cwd,
			'shadowed',
			'global',
			'project',
			'global-shadow-copy',
		);
		expect(selected_global.preset?.instructions).toBe(
			'Global definition.',
		);
		const selected_project = copy_prompt_preset(
			cwd,
			'shadowed',
			'project',
			'global',
			'project-shadow-copy',
		);
		expect(selected_project.preset?.instructions).toBe(
			'Project definition.',
		);
	});

	it('renames custom presets and updates active and persisted selection by kind', () => {
		create_prompt_preset(cwd, 'project', 'base-old', {
			kind: 'base',
			instructions: 'Base.',
		});
		create_prompt_preset(cwd, 'project', 'layer-old', {
			kind: 'layer',
			instructions: 'Layer.',
		});
		save_persisted_prompt_state(cwd, {
			base_name: 'base-old',
			layer_names: ['layer-old'],
		});
		const base = rename_prompt_preset(
			cwd,
			'project',
			'base-old',
			'base-new',
			{
				base_name: 'base-old',
				layer_names: ['layer-old'],
			},
		);
		expect(base.state).toEqual({
			base_name: 'base-new',
			layer_names: ['layer-old'],
		});
		const layer = rename_prompt_preset(
			cwd,
			'project',
			'layer-old',
			'layer-new',
			base.state,
		);
		expect(layer.state).toEqual({
			base_name: 'base-new',
			layer_names: ['layer-new'],
		});
		expect(load_persisted_prompt_state(cwd)).toEqual(layer.state);
	});

	it('rolls back rename when persisted selection cannot be updated', () => {
		const created = create_prompt_preset(cwd, 'project', 'before', {
			instructions: 'Keep me.',
		});
		save_persisted_prompt_state(cwd, {
			base_name: 'before',
			layer_names: [],
		});
		mocked.fail_write = true;
		expect(() =>
			rename_prompt_preset(cwd, 'project', 'before', 'after'),
		).toThrow('simulated settings failure');
		expect(existsSync(created.path)).toBe(true);
		expect(existsSync(join(cwd, '.pi', 'presets', 'after.md'))).toBe(
			false,
		);
	});

	it('provides deletion confirmation metadata and rejects built-in mutation', () => {
		create_prompt_preset(cwd, 'project', 'temporary', {
			kind: 'layer',
			instructions: 'Temporary.',
		});
		const confirmation = get_delete_prompt_preset_confirmation(
			cwd,
			'project',
			'temporary',
			{ base_name: null, layer_names: ['temporary'] },
		);
		expect(confirmation).toMatchObject({
			name: 'temporary',
			scope: 'project',
			kind: 'layer',
			active: true,
		});
		expect(() =>
			delete_prompt_preset(cwd, 'project', 'temporary'),
		).toThrowError(
			expect.objectContaining({ code: 'confirmation-required' }),
		);
		expect(
			delete_prompt_preset(cwd, 'project', 'temporary', true).preset,
		).toBeUndefined();
		expect(() =>
			delete_prompt_preset(cwd, 'project', 'terse', true),
		).toThrowError(expect.objectContaining({ code: 'read-only' }));
	});

	it('resets exactly one Markdown override and preserves legacy bridge data', () => {
		save_project_prompt_presets(cwd, {
			terse: { instructions: 'Legacy project JSON.' },
		});
		create_prompt_preset(cwd, 'project', 'terse', {
			instructions: 'Canonical Markdown override.',
		});
		const reset = reset_prompt_preset_override(
			cwd,
			'project',
			'terse',
		);
		expect(reset.preset).toMatchObject({
			origin: 'project-json',
			instructions: 'Legacy project JSON.',
		});
		expect(existsSync(join(cwd, '.pi', 'presets.json'))).toBe(true);
		expect(() =>
			delete_prompt_preset(cwd, 'project', 'terse', true),
		).toThrowError(
			expect.objectContaining({ code: 'source-mismatch' }),
		);
		expect(existsSync(join(cwd, '.pi', 'presets.json'))).toBe(true);
	});

	it('reloads external edits with exact diagnostics and respects project trust', () => {
		const dir = join(cwd, '.pi', 'presets');
		create_prompt_preset(cwd, 'project', 'valid', {
			instructions: 'Valid.',
		});
		const invalid_path = join(dir, 'invalid.md');
		writeFileSync(invalid_path, '---\nkind: base\n---\n');
		const invalid_kind_path = join(dir, 'invalid-kind.md');
		writeFileSync(
			invalid_kind_path,
			'---\nkind: nonsense\n---\n\nMust not load.\n',
		);
		const catalog = reload_prompt_preset_library(cwd);
		expect(catalog.presets.valid).toBeDefined();
		expect(catalog.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'invalid-source',
					path: invalid_path,
					origin: 'project-markdown',
				}),
				expect.objectContaining({
					code: 'invalid-source',
					path: invalid_kind_path,
					origin: 'project-markdown',
				}),
			]),
		);
		expect(catalog.presets['invalid-kind']).toBeUndefined();
		process.env.MY_PI_PROMPT_PRESETS_PROJECT = 'skip';
		const trusted = reload_prompt_preset_library(cwd);
		expect(trusted.presets.valid).toBeUndefined();
		expect(
			trusted.diagnostics.some((item) =>
				item.origin.startsWith('project'),
			),
		).toBe(false);
		expect(() =>
			create_prompt_preset(cwd, 'project', 'blocked', {
				instructions: 'Blocked.',
			}),
		).toThrowError(
			expect.objectContaining({ code: 'project-disabled' }),
		);
	});
});
