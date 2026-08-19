import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_PROMPT_PRESETS,
	get_current_thinking_level,
	get_default_footer_thinking_level,
	load_persisted_prompt_state,
	load_prompt_preset_catalog,
	load_prompt_presets,
	merge_prompt_presets,
	migrate_legacy_prompt_presets,
	normalize_prompt_presets,
	read_prompt_presets_dir,
	remove_project_prompt_preset,
	render_footer_status_line,
	save_persisted_prompt_state,
	save_project_prompt_presets,
	save_prompt_preset_file,
} from './index.js';

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
	const original_project_presets =
		process.env.MY_PI_PROMPT_PRESETS_PROJECT;
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		if (original_project_presets === undefined) {
			delete process.env.MY_PI_PROMPT_PRESETS_PROJECT;
		} else {
			process.env.MY_PI_PROMPT_PRESETS_PROJECT =
				original_project_presets;
		}
	});

	it('loads markdown presets with YAML frontmatter from a presets directory', () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(root);

		save_prompt_preset_file(root, 'careful', {
			kind: 'layer',
			description: 'Call out risk',
			instructions: 'Mention the important caveat.',
		});
		writeFileSync(
			join(root, 'yaml.md'),
			'---\nkind: layer\ndescription: >\n  Multi-line\n  description\n---\n\nUse YAML frontmatter.\n',
		);

		expect(read_prompt_presets_dir(root)).toEqual({
			careful: {
				kind: 'layer',
				description: 'Call out risk',
				instructions: 'Mention the important caveat.',
			},
			yaml: {
				kind: 'layer',
				description: 'Multi-line description\n',
				instructions: 'Use YAML frontmatter.',
			},
		});
	});

	it('reports exact precedence, ownership, and fallback provenance', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);
		save_project_prompt_presets(cwd, {
			terse: { instructions: 'Use legacy project JSON.' },
		});
		save_prompt_preset_file(join(cwd, '.pi', 'presets'), 'terse', {
			kind: 'base',
			instructions: 'Use canonical project Markdown.',
		});

		const catalog = load_prompt_preset_catalog(cwd);
		expect(catalog.presets.terse).toMatchObject({
			origin: 'project-markdown',
			path: join(cwd, '.pi', 'presets', 'terse.md'),
			editable: true,
			instructions: 'Use canonical project Markdown.',
		});
		expect(catalog.presets.terse.fallbacks[0]).toMatchObject({
			origin: 'project-json',
			path: join(cwd, '.pi', 'presets.json'),
			editable: false,
		});
		expect(catalog.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'shadowed',
				name: 'terse',
				origin: 'project-json',
			}),
		);
	});

	it('keeps valid siblings and diagnoses malformed Markdown and JSON sources', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-invalid-presets-'));
		dirs.push(cwd);
		const dir = join(cwd, '.pi', 'presets');
		const valid_path = save_prompt_preset_file(dir, 'valid', {
			instructions: 'Still loaded.',
		});
		const invalid_path = join(dir, 'invalid.md');
		writeFileSync(invalid_path, '---\nkind: base\n---\n');
		const json_path = join(cwd, '.pi', 'presets.json');
		writeFileSync(json_path, '{not json');

		const catalog = load_prompt_preset_catalog(cwd);
		expect(catalog.presets.valid).toMatchObject({
			path: valid_path,
			instructions: 'Still loaded.',
		});
		expect(catalog.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'invalid-source',
					path: invalid_path,
					origin: 'project-markdown',
				}),
				expect.objectContaining({
					code: 'invalid-source',
					path: json_path,
					origin: 'project-json',
				}),
			]),
		);
		expect(read_prompt_presets_dir(dir)).toEqual({
			valid: { kind: 'base', instructions: 'Still loaded.' },
		});
	});

	it('reports the exact path of externally-created Markdown files', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);
		const dir = join(cwd, '.pi', 'presets');
		const path = join(dir, 'odd:name.md');
		save_prompt_preset_file(dir, 'placeholder', {
			instructions: 'Placeholder.',
		});
		writeFileSync(path, '---\nkind: base\n---\n\nExact path.\n');

		expect(
			load_prompt_preset_catalog(cwd).presets['odd:name'],
		).toMatchObject({
			path,
			origin: 'project-markdown',
			instructions: 'Exact path.',
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

	it('can skip project prompt presets for untrusted repo mode', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);
		process.env.MY_PI_PROMPT_PRESETS_PROJECT = 'skip';

		const project_dir = join(cwd, '.pi', 'presets');
		save_prompt_preset_file(project_dir, 'terse', {
			kind: 'base',
			description: 'Project terse',
			instructions: 'Use the project terse style.',
		});
		writeFileSync(
			join(project_dir, 'invalid.md'),
			'---\nkind: base\n---\n',
		);
		writeFileSync(join(cwd, '.pi', 'presets.json'), '{not json');

		const catalog = load_prompt_preset_catalog(cwd);
		const preset = catalog.presets.terse;
		expect(preset.name).toBe('terse');
		expect(preset.source).not.toBe('project');
		expect(preset.instructions).not.toBe(
			'Use the project terse style.',
		);
		expect(
			catalog.diagnostics.some((diagnostic) =>
				diagnostic.origin.startsWith('project'),
			),
		).toBe(false);
	});

	it('migrates project JSON without overwriting Markdown and is idempotent', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-file-presets-'));
		dirs.push(cwd);
		save_project_prompt_presets(cwd, {
			alpha: { instructions: 'Move me.' },
			'a/b': { instructions: 'Keep this exact logical name.' },
			collision: { instructions: 'Keep this legacy value.' },
		});
		save_prompt_preset_file(
			join(cwd, '.pi', 'presets'),
			'collision',
			{
				instructions: 'Do not overwrite me.',
			},
		);

		const first = migrate_legacy_prompt_presets(cwd, 'project');
		expect(first.written).toEqual([
			join(cwd, '.pi', 'presets', 'alpha.md'),
		]);
		expect(first.remaining_legacy).toBe(2);
		expect(first.collisions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'migration-unsafe-name',
					name: 'a/b',
				}),
				expect.objectContaining({
					code: 'migration-collision',
					name: 'collision',
				}),
			]),
		);
		expect(
			readFileSync(
				join(cwd, '.pi', 'presets', 'collision.md'),
				'utf-8',
			),
		).toContain('Do not overwrite me.');
		expect(
			JSON.parse(
				readFileSync(join(cwd, '.pi', 'presets.json'), 'utf-8'),
			),
		).toEqual({
			'a/b': { instructions: 'Keep this exact logical name.' },
			collision: { instructions: 'Keep this legacy value.' },
		});

		const second = migrate_legacy_prompt_presets(cwd, 'project');
		expect(second.written).toEqual([]);
		expect(second.remaining_legacy).toBe(2);
		expect(second.collisions).toHaveLength(2);
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

type FooterModel = Parameters<
	typeof get_default_footer_thinking_level
>[0];

function make_model(
	overrides: Partial<FooterModel> = {},
): FooterModel {
	return {
		id: 'test-model',
		name: 'Test Model',
		api: 'openai-completions',
		provider: 'test',
		baseUrl: 'http://localhost/v1',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
		...overrides,
	} as FooterModel;
}

describe('thinking footer helpers', () => {
	it('defaults to the model-clamped medium thinking level', () => {
		const high_only_model = make_model({
			thinkingLevelMap: {
				minimal: null,
				low: null,
				medium: null,
				high: 'high',
				xhigh: null,
			},
		});

		expect(get_default_footer_thinking_level(high_only_model)).toBe(
			'high',
		);
	});

	it('clamps restored thinking entries to supported model levels', () => {
		const high_only_model = make_model({
			thinkingLevelMap: {
				minimal: null,
				low: null,
				medium: null,
				high: 'high',
				xhigh: null,
			},
		});
		const ctx = {
			model: high_only_model,
			sessionManager: {
				getEntries: () => [
					{ type: 'thinking_level_change', thinkingLevel: 'medium' },
				],
			},
		} as Parameters<typeof get_current_thinking_level>[0];

		expect(get_current_thinking_level(ctx)).toBe('high');
	});

	it('hides thinking for non-reasoning models', () => {
		const ctx = {
			model: make_model({ reasoning: false }),
			sessionManager: {
				getEntries: () => [
					{ type: 'thinking_level_change', thinkingLevel: 'high' },
				],
			},
		} as Parameters<typeof get_current_thinking_level>[0];

		expect(get_current_thinking_level(ctx)).toBe('off');
	});
});

describe('render_footer_status_line', () => {
	const theme = {
		fg: (_token: string, text: string) => text,
	} as Parameters<typeof render_footer_status_line>[0];

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
