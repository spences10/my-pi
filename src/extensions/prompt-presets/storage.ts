import {
	getAgentDir,
	parseFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
	get_settings_path,
	read_settings,
	write_settings,
} from '@spences10/pi-settings';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_PROMPT_PRESETS } from './defaults.js';
import type {
	LoadedPromptPreset,
	PromptPreset,
	PromptPresetCatalog,
	PromptPresetDefinition,
	PromptPresetDiagnostic,
	PromptPresetMap,
	PromptPresetMigrationResult,
	PromptPresetOrigin,
	PromptPresetSource,
	PromptPresetState,
} from './types.js';

const PROJECT_PROMPT_PRESETS_ENV = 'MY_PI_PROMPT_PRESETS_PROJECT';

interface PersistedPromptPresetStates {
	version: number;
	projects: Record<string, PromptPresetState>;
}

export function normalize_prompt_presets(
	input: unknown,
): PromptPresetMap {
	if (!input || typeof input !== 'object') return {};

	const normalized: PromptPresetMap = {};
	for (const [raw_name, raw_value] of Object.entries(input)) {
		const name = raw_name.trim();
		if (!name) continue;

		if (typeof raw_value === 'string') {
			normalized[name] = {
				kind: 'base',
				instructions: raw_value,
			};
			continue;
		}

		if (!raw_value || typeof raw_value !== 'object') continue;
		const candidate = raw_value as {
			kind?: unknown;
			description?: unknown;
			instructions?: unknown;
		};
		if (typeof candidate.instructions !== 'string') continue;

		normalized[name] = {
			instructions: candidate.instructions,
			...(candidate.kind === 'layer'
				? { kind: 'layer' as const }
				: {}),
			...(typeof candidate.description === 'string'
				? { description: candidate.description }
				: {}),
		};
	}

	return normalized;
}

export function merge_prompt_presets(
	...sources: PromptPresetMap[]
): PromptPresetMap {
	return Object.assign({}, ...sources);
}

function to_prompt_preset_definitions(
	presets: PromptPresetMap,
	source: PromptPresetSource,
	origin: PromptPresetOrigin,
	path: string | null,
	editable: boolean,
): Record<string, PromptPresetDefinition> {
	return Object.fromEntries(
		Object.entries(presets).map(([name, preset]) => [
			name,
			{
				name,
				kind: preset.kind === 'layer' ? 'layer' : 'base',
				source,
				origin,
				path,
				editable,
				...preset,
			},
		]),
	);
}

function read_prompt_preset_markdown_definitions(
	dir: string,
	source: PromptPresetSource,
	origin: 'global-markdown' | 'project-markdown',
): {
	definitions: Record<string, PromptPresetDefinition>;
	diagnostics: PromptPresetDiagnostic[];
} {
	const definitions: Record<string, PromptPresetDefinition> = {};
	const diagnostics: PromptPresetDiagnostic[] = [];
	if (!existsSync(dir)) return { definitions, diagnostics };
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		diagnostics.push({
			code: 'invalid-source',
			message: `Could not read prompt preset directory: ${String(error)}`,
			path: dir,
			origin,
		});
		return { definitions, diagnostics };
	}
	for (const entry of entries
		.filter((item) => item.isFile() && item.name.endsWith('.md'))
		.sort((a, b) => a.name.localeCompare(b.name))) {
		const name = entry.name.slice(0, -3).trim();
		const path = join(dir, entry.name);
		if (!name) continue;
		try {
			const { metadata, body } = parse_prompt_preset_markdown(
				readFileSync(path, 'utf-8'),
			);
			if (
				metadata.kind !== undefined &&
				metadata.kind !== 'base' &&
				metadata.kind !== 'layer'
			) {
				throw new Error(
					`kind must be "base" or "layer", received ${JSON.stringify(metadata.kind)}`,
				);
			}
			if (!body) throw new Error('instructions body is empty');
			definitions[name] = {
				name,
				kind: metadata.kind === 'layer' ? 'layer' : 'base',
				instructions: body,
				source,
				origin,
				path,
				editable: true,
				...(typeof metadata.description === 'string' &&
				metadata.description.trim()
					? { description: metadata.description }
					: {}),
			};
		} catch (error) {
			diagnostics.push({
				code: 'invalid-source',
				name,
				message: `Could not read prompt preset Markdown: ${String(error)}`,
				path,
				origin,
			});
		}
	}
	return { definitions, diagnostics };
}

export function get_global_presets_path(): string {
	return join(getAgentDir(), 'presets.json');
}

export function get_project_presets_path(cwd: string): string {
	return join(cwd, '.pi', 'presets.json');
}

export function get_global_presets_dir(): string {
	return join(getAgentDir(), 'presets');
}

export function get_project_presets_dir(cwd: string): string {
	return join(cwd, '.pi', 'presets');
}

function sanitize_prompt_preset_file_name(name: string): string {
	const sanitized = name
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/^\.+$/, '')
		.replace(/^\.+/, '')
		.replace(/\.+$/, '');
	if (!sanitized) {
		throw new Error(
			'Prompt preset name must contain a file-safe character',
		);
	}
	return sanitized;
}

export function get_prompt_preset_file_path(
	dir: string,
	name: string,
): string {
	return join(dir, `${sanitize_prompt_preset_file_name(name)}.md`);
}

function get_persisted_prompt_state_path(): string {
	return join(getAgentDir(), 'prompt-preset-state.json');
}

function read_prompt_presets_file(path: string): PromptPresetMap {
	try {
		if (path === get_global_presets_path()) {
			return normalize_prompt_presets(
				read_settings().promptPresets?.global ?? {},
			);
		}
		if (!existsSync(path)) return {};
		return normalize_prompt_presets(
			JSON.parse(readFileSync(path, 'utf-8')),
		);
	} catch {
		return {};
	}
}

function read_global_prompt_presets_source(): {
	presets: PromptPresetMap;
	diagnostics: PromptPresetDiagnostic[];
} {
	const path = get_settings_path();
	try {
		return {
			presets: normalize_prompt_presets(
				read_settings().promptPresets?.global ?? {},
			),
			diagnostics: [],
		};
	} catch (error) {
		return {
			presets: {},
			diagnostics: [
				{
					code: 'invalid-source',
					message: `Could not read legacy global prompt presets: ${String(error)}`,
					path,
					origin: 'legacy-global-settings',
				},
			],
		};
	}
}

function read_prompt_presets_json_source(
	path: string,
	origin: 'project-json',
): {
	presets: PromptPresetMap;
	diagnostics: PromptPresetDiagnostic[];
} {
	if (!existsSync(path)) return { presets: {}, diagnostics: [] };
	try {
		return {
			presets: normalize_prompt_presets(
				JSON.parse(readFileSync(path, 'utf-8')),
			),
			diagnostics: [],
		};
	} catch (error) {
		return {
			presets: {},
			diagnostics: [
				{
					code: 'invalid-source',
					message: `Could not read prompt preset JSON: ${String(error)}`,
					path,
					origin,
				},
			],
		};
	}
}

export function parse_prompt_preset_markdown(content: string): {
	metadata: Record<string, unknown>;
	body: string;
} {
	const { frontmatter, body } = parseFrontmatter(content);
	return { metadata: frontmatter, body: body.trim() };
}

export function read_prompt_presets_dir(
	path: string,
): PromptPresetMap {
	const { definitions } = read_prompt_preset_markdown_definitions(
		path,
		'user',
		'global-markdown',
	);
	return Object.fromEntries(
		Object.entries(definitions).map(([name, definition]) => [
			name,
			{
				kind: definition.kind,
				instructions: definition.instructions,
				...(definition.description
					? { description: definition.description }
					: {}),
			},
		]),
	);
}

export function format_prompt_preset_markdown(
	preset: PromptPreset,
): string {
	const lines = [
		'---',
		`kind: ${preset.kind === 'layer' ? 'layer' : 'base'}`,
	];
	if (preset.description?.trim()) {
		lines.push(
			`description: ${JSON.stringify(preset.description.trim())}`,
		);
	}
	lines.push('---', '', preset.instructions.trim(), '');
	return lines.join('\n');
}

export function save_prompt_preset_file(
	dir: string,
	name: string,
	preset: PromptPreset,
): string {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const path = get_prompt_preset_file_path(dir, name);
	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, format_prompt_preset_markdown(preset), {
		mode: 0o600,
	});
	renameSync(tmp, path);
	return path;
}

export function save_project_prompt_preset_file(
	cwd: string,
	name: string,
	preset: PromptPreset,
): string {
	return save_prompt_preset_file(
		get_project_presets_dir(cwd),
		name,
		preset,
	);
}

export function save_global_prompt_preset_file(
	name: string,
	preset: PromptPreset,
): string {
	return save_prompt_preset_file(
		get_global_presets_dir(),
		name,
		preset,
	);
}

function should_load_project_prompt_presets(): boolean {
	const normalized = process.env[PROJECT_PROMPT_PRESETS_ENV]
		?.trim()
		.toLowerCase();
	return !['0', 'false', 'no', 'skip', 'disable'].includes(
		normalized ?? '',
	);
}

export function load_prompt_preset_catalog(
	cwd: string,
): PromptPresetCatalog {
	const legacy_global = read_global_prompt_presets_source();
	const global_markdown = read_prompt_preset_markdown_definitions(
		get_global_presets_dir(),
		'user',
		'global-markdown',
	);
	const project_json = read_prompt_presets_json_source(
		get_project_presets_path(cwd),
		'project-json',
	);
	const project_markdown = read_prompt_preset_markdown_definitions(
		get_project_presets_dir(cwd),
		'project',
		'project-markdown',
	);
	const source_diagnostics: PromptPresetDiagnostic[] = [
		...legacy_global.diagnostics,
		...global_markdown.diagnostics,
	];
	const sources: Array<Record<string, PromptPresetDefinition>> = [
		to_prompt_preset_definitions(
			DEFAULT_PROMPT_PRESETS,
			'builtin',
			'builtin',
			null,
			false,
		),
		to_prompt_preset_definitions(
			legacy_global.presets,
			'user',
			'legacy-global-settings',
			get_settings_path(),
			false,
		),
		global_markdown.definitions,
	];
	if (should_load_project_prompt_presets()) {
		source_diagnostics.push(
			...project_json.diagnostics,
			...project_markdown.diagnostics,
		);
		sources.push(
			to_prompt_preset_definitions(
				project_json.presets,
				'project',
				'project-json',
				get_project_presets_path(cwd),
				false,
			),
			project_markdown.definitions,
		);
	}

	const chains = new Map<string, PromptPresetDefinition[]>();
	for (const source of sources) {
		for (const definition of Object.values(source)) {
			const chain = chains.get(definition.name) ?? [];
			chain.push(definition);
			chains.set(definition.name, chain);
		}
	}
	const diagnostics: PromptPresetDiagnostic[] = [
		...source_diagnostics,
	];
	const presets: Record<string, LoadedPromptPreset> = {};
	for (const [name, chain] of chains) {
		const winner = chain.at(-1)!;
		const fallbacks = chain.slice(0, -1).reverse();
		presets[name] = { ...winner, fallbacks };
		for (const shadowed of fallbacks) {
			diagnostics.push({
				code: 'shadowed',
				name,
				message: `${shadowed.origin} definition is shadowed by ${winner.origin}`,
				path: shadowed.path,
				origin: shadowed.origin,
			});
		}
	}
	return { presets, diagnostics };
}

export function load_prompt_presets(
	cwd: string,
): Record<string, LoadedPromptPreset> {
	return load_prompt_preset_catalog(cwd).presets;
}

function sort_prompt_presets(
	presets: PromptPresetMap,
): PromptPresetMap {
	return Object.fromEntries(
		Object.entries(presets).sort(([a], [b]) => a.localeCompare(b)),
	);
}

export function save_project_prompt_presets(
	cwd: string,
	presets: PromptPresetMap,
): string {
	const path = get_project_presets_path(cwd);
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(
		tmp,
		JSON.stringify(sort_prompt_presets(presets), null, '\t') + '\n',
		{ mode: 0o600 },
	);
	renameSync(tmp, path);
	return path;
}

export function migrate_legacy_prompt_presets(
	cwd: string,
	scope: 'global' | 'project',
): PromptPresetMigrationResult {
	return migrate_legacy_prompt_presets_with_dependencies(cwd, scope, {
		global_presets_dir: get_global_presets_dir(),
		settings_path: get_settings_path(),
		read_settings,
		write_settings,
	});
}

function migrate_legacy_prompt_presets_with_dependencies(
	cwd: string,
	scope: 'global' | 'project',
	dependencies: {
		global_presets_dir: string;
		settings_path: string;
		read_settings: typeof read_settings;
		write_settings: typeof write_settings;
	},
): PromptPresetMigrationResult {
	const read_global_settings = dependencies.read_settings;
	const write_global_settings = dependencies.write_settings;
	const legacy_path =
		scope === 'global'
			? dependencies.settings_path
			: get_project_presets_path(cwd);
	const destination =
		scope === 'global'
			? dependencies.global_presets_dir
			: get_project_presets_dir(cwd);
	const legacy =
		scope === 'global'
			? normalize_prompt_presets(
					read_global_settings().promptPresets?.global ?? {},
				)
			: read_prompt_presets_file(legacy_path);
	const written: string[] = [];
	const collisions: PromptPresetDiagnostic[] = [];
	const remaining: PromptPresetMap = {};
	if (Object.keys(legacy).length === 0) {
		return {
			scope,
			written,
			collisions,
			legacy_path,
			remaining_legacy: 0,
		};
	}

	for (const [name, preset] of Object.entries(legacy)) {
		let path: string;
		try {
			path = get_prompt_preset_file_path(destination, name);
		} catch {
			remaining[name] = preset;
			collisions.push({
				code: 'migration-unsafe-name',
				name,
				message: `Kept legacy definition because its name cannot round-trip to a Markdown filename`,
				path: legacy_path,
				origin:
					scope === 'global'
						? 'legacy-global-settings'
						: 'project-json',
			});
			continue;
		}
		if (path !== join(destination, `${name}.md`)) {
			remaining[name] = preset;
			collisions.push({
				code: 'migration-unsafe-name',
				name,
				message: `Kept legacy definition because its name would change in Markdown`,
				path: legacy_path,
				origin:
					scope === 'global'
						? 'legacy-global-settings'
						: 'project-json',
			});
			continue;
		}
		if (existsSync(path)) {
			remaining[name] = preset;
			collisions.push({
				code: 'migration-collision',
				name,
				message: `Kept legacy definition because ${path} already exists`,
				path,
				origin:
					scope === 'global'
						? 'legacy-global-settings'
						: 'project-json',
			});
			continue;
		}
		save_prompt_preset_file(destination, name, preset);
		written.push(path);
	}

	if (scope === 'global') {
		const settings = read_global_settings();
		write_global_settings({
			...settings,
			promptPresets: {
				...settings.promptPresets,
				global:
					Object.keys(remaining).length > 0
						? sort_prompt_presets(remaining)
						: undefined,
			},
		});
	} else if (Object.keys(remaining).length > 0) {
		save_project_prompt_presets(cwd, remaining);
	} else if (existsSync(legacy_path)) {
		unlinkSync(legacy_path);
	}

	return {
		scope,
		written,
		collisions,
		legacy_path,
		remaining_legacy: Object.keys(remaining).length,
	};
}

export function remove_project_prompt_preset(
	cwd: string,
	name: string,
): {
	removed: boolean;
	path: string;
	remaining: number;
} {
	const json_path = get_project_presets_path(cwd);
	const project_presets = read_prompt_presets_file(json_path);
	let removed = false;
	let removed_path = json_path;

	if (name in project_presets) {
		delete project_presets[name];
		removed = true;
		removed_path = json_path;
		if (Object.keys(project_presets).length === 0) {
			if (existsSync(json_path)) {
				unlinkSync(json_path);
			}
		} else {
			save_project_prompt_presets(cwd, project_presets);
		}
	}

	const file_path = get_prompt_preset_file_path(
		get_project_presets_dir(cwd),
		name,
	);
	if (existsSync(file_path)) {
		unlinkSync(file_path);
		removed = true;
		removed_path = file_path;
	}

	const remaining =
		Object.keys(read_prompt_presets_file(json_path)).length +
		Object.keys(read_prompt_presets_dir(get_project_presets_dir(cwd)))
			.length;

	return { removed, path: removed_path, remaining };
}

function normalize_prompt_preset_state(
	input: unknown,
): PromptPresetState | undefined {
	if (!input || typeof input !== 'object') return undefined;

	const candidate = input as {
		base_name?: unknown;
		layer_names?: unknown;
	};
	const base_name =
		typeof candidate.base_name === 'string' &&
		candidate.base_name.trim()
			? candidate.base_name.trim()
			: null;
	const layer_names = Array.isArray(candidate.layer_names)
		? [
				...new Set(
					candidate.layer_names
						.filter(
							(value): value is string =>
								typeof value === 'string' && value.trim().length > 0,
						)
						.map((value) => value.trim()),
				),
			].sort()
		: [];

	return {
		base_name,
		layer_names,
	};
}

function read_persisted_prompt_states(
	path = get_persisted_prompt_state_path(),
): PersistedPromptPresetStates {
	try {
		const parsed = (
			path === get_persisted_prompt_state_path()
				? (read_settings().promptPresets?.state ?? {})
				: existsSync(path)
					? JSON.parse(readFileSync(path, 'utf-8'))
					: {}
		) as {
			version?: unknown;
			projects?: unknown;
		};
		const raw_projects =
			parsed.projects && typeof parsed.projects === 'object'
				? parsed.projects
				: {};
		const projects: Record<string, PromptPresetState> = {};
		for (const [cwd, value] of Object.entries(raw_projects)) {
			const normalized = normalize_prompt_preset_state(value);
			if (!normalized) continue;
			projects[cwd] = normalized;
		}
		return {
			version:
				typeof parsed.version === 'number' ? parsed.version : 1,
			projects,
		};
	} catch {
		return { version: 1, projects: {} };
	}
}

export function load_persisted_prompt_state(
	cwd: string,
	path = get_persisted_prompt_state_path(),
): PromptPresetState | undefined {
	return read_persisted_prompt_states(path).projects[cwd];
}

export function save_persisted_prompt_state(
	cwd: string,
	state: PromptPresetState,
	path = get_persisted_prompt_state_path(),
): string {
	const persisted = read_persisted_prompt_states(path);
	persisted.projects[cwd] = normalize_prompt_preset_state(state) ?? {
		base_name: null,
		layer_names: [],
	};

	const next = {
		version: 1,
		projects: Object.fromEntries(
			Object.entries(persisted.projects).sort(([a], [b]) =>
				a.localeCompare(b),
			),
		),
	};
	if (path === get_persisted_prompt_state_path()) {
		const settings = read_settings();
		write_settings({
			...settings,
			promptPresets: { ...settings.promptPresets, state: next },
		});
		return path;
	}

	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(next, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
	return path;
}
