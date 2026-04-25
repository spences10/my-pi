import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_PROMPT_PRESETS,
	load_persisted_prompt_state,
	load_prompt_presets,
	merge_prompt_presets,
	normalize_prompt_presets,
	read_prompt_presets_dir,
	remove_project_prompt_preset,
	render_footer_status_line,
	save_persisted_prompt_state,
	save_project_prompt_presets,
	save_prompt_preset_file,
} from './prompt-presets.js';

describe('normalize_prompt_presets', () => {
	it('accepts string shorthand instructions', () => {
		expect(normalize_prompt_presets({ terse: 'Be brief.' })).toEqual({
			terse: { kind: 'base', instructions: 'Be brief.' },
		});
	});

	it('keeps valid object presets and skips invalid entries', () => {
		expect(
			normalize_prompt_presets({
				good: {
					description: 'Useful',
					instructions: 'Do the thing.',
				},
				layered: {
					kind: 'layer',
					instructions: 'Layer it on.',
				},
				bad: { description: 'Missing instructions' },
				nope: 42,
			}),
		).toEqual({
			good: {
				description: 'Useful',
				instructions: 'Do the thing.',
			},
			layered: {
				kind: 'layer',
				instructions: 'Layer it on.',
			},
		});
	});
});

describe('merge_prompt_presets', () => {
	it('lets later sources override earlier ones', () => {
		const merged = merge_prompt_presets(DEFAULT_PROMPT_PRESETS, {
			terse: {
				description: 'Project terse',
				instructions: 'Project override.',
			},
			custom: {
				instructions: 'Custom preset.',
			},
		});

		expect(merged.terse).toEqual({
			description: 'Project terse',
			instructions: 'Project override.',
		});
		expect(merged.custom).toEqual({
			instructions: 'Custom preset.',
		});
		expect(merged.standard).toEqual(DEFAULT_PROMPT_PRESETS.standard);
	});
});

describe('file-backed prompt presets', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('loads markdown presets with frontmatter from a presets directory', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(root);

		save_prompt_preset_file(root, 'careful', {
			kind: 'layer',
			description: 'Call out risk',
			instructions: 'Mention the important caveat.',
		});

		expect(read_prompt_presets_dir(root)).toEqual({
			careful: {
				kind: 'layer',
				description: 'Call out risk',
				instructions: 'Mention the important caveat.',
			},
		});
	});

	it('lets project markdown preset files override built-in presets', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);

		save_prompt_preset_file(join(cwd, '.pi', 'presets'), 'terse', {
			kind: 'base',
			description: 'Project terse',
			instructions: 'Use the project terse style.',
		});

		expect(load_prompt_presets(cwd).terse).toMatchObject({
			name: 'terse',
			kind: 'base',
			source: 'project',
			description: 'Project terse',
			instructions: 'Use the project terse style.',
		});
	});

	it('removes project markdown preset files', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);

		const path = save_prompt_preset_file(
			join(cwd, '.pi', 'presets'),
			'local',
			{
				kind: 'base',
				description: 'Local base',
				instructions: 'Use the local style.',
			},
		);

		const result = remove_project_prompt_preset(cwd, 'local');
		expect(result.removed).toBe(true);
		expect(result.path).toBe(path);
		expect(result.remaining).toBe(0);
		expect(existsSync(path)).toBe(false);
	});
});

const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(27)}\\[[0-9;]*m`,
	'g',
);

function strip_ansi(value: string): string {
	return value.replace(ANSI_ESCAPE_PATTERN, '');
}

describe('render_footer_status_line', () => {
	const theme = {
		fg: (_token: string, text: string) => text,
	} as any;

	it('places extension status left and prompt status right on one line', () => {
		expect(
			strip_ansi(
				render_footer_status_line(
					theme,
					60,
					['MCP 5/5 connected'],
					'prompt:terse',
				) ?? '',
			),
		).toBe(
			'MCP 5/5 connected                               prompt:terse',
		);
	});

	it('keeps right-aligned prompt status when no extension statuses exist', () => {
		expect(
			strip_ansi(
				render_footer_status_line(theme, 20, [], 'prompt:terse') ??
					'',
			),
		).toBe('        prompt:terse');
	});

	it('truncates left status to preserve the prompt status', () => {
		expect(
			strip_ansi(
				render_footer_status_line(
					theme,
					28,
					['MCP 5/5 connected', 'Indicator: custom spinner'],
					'prompt:terse',
				) ?? '',
			),
		).toBe('MCP 5/5 conn... prompt:terse');
	});
});

describe('project preset persistence', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('removes a preset from the project file', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-presets-'));
		dirs.push(cwd);

		save_project_prompt_presets(cwd, {
			alpha: { instructions: 'A' },
			beta: { kind: 'layer', instructions: 'B' },
		});

		const result = remove_project_prompt_preset(cwd, 'alpha');
		expect(result.removed).toBe(true);
		expect(result.remaining).toBe(1);

		const saved = JSON.parse(
			readFileSync(join(cwd, '.pi', 'presets.json'), 'utf-8'),
		);
		expect(saved).toEqual({
			beta: { kind: 'layer', instructions: 'B' },
		});
	});

	it('deletes the file when the last preset is removed', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-presets-'));
		dirs.push(cwd);

		save_project_prompt_presets(cwd, {
			only: { instructions: 'A' },
		});

		const result = remove_project_prompt_preset(cwd, 'only');
		expect(result.removed).toBe(true);
		expect(result.remaining).toBe(0);
		expect(existsSync(join(cwd, '.pi', 'presets.json'))).toBe(false);
	});

	it('persists the active prompt selection per project', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-preset-state-'));
		dirs.push(root);

		const state_path = join(root, 'prompt-preset-state.json');
		const project_a = join(root, 'project-a');
		const project_b = join(root, 'project-b');

		save_persisted_prompt_state(
			project_a,
			{ base_name: 'terse', layer_names: ['bullets'] },
			state_path,
		);
		save_persisted_prompt_state(
			project_b,
			{
				base_name: null,
				layer_names: ['include-risks', 'bullets', 'include-risks'],
			},
			state_path,
		);

		expect(
			load_persisted_prompt_state(project_a, state_path),
		).toEqual({
			base_name: 'terse',
			layer_names: ['bullets'],
		});
		expect(
			load_persisted_prompt_state(project_b, state_path),
		).toEqual({
			base_name: null,
			layer_names: ['bullets', 'include-risks'],
		});
	});
});
