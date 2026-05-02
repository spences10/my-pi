import { getAgentDir } from '@mariozechner/pi-coding-agent';
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
	PromptPresetMap,
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

function to_loaded_prompt_presets(
	presets: PromptPresetMap,
	source: PromptPresetSource,
): Record<string, LoadedPromptPreset> {
	return Object.fromEntries(
		Object.entries(presets).map(([name, preset]) => [
			name,
			{
				name,
				kind: preset.kind === 'layer' ? 'layer' : 'base',
				source,
				...preset,
			},
		]),
	);
}

function get_global_presets_path(): string {
	return join(getAgentDir(), 'presets.json');
}

function get_project_presets_path(cwd: string): string {
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
	if (!existsSync(path)) return {};

	try {
		return normalize_prompt_presets(
			JSON.parse(readFileSync(path, 'utf-8')),
		);
	} catch {
		return {};
	}
}

function unquote_frontmatter_value(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parse_prompt_preset_markdown(content: string): {
	metadata: Record<string, string>;
	body: string;
} {
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return { metadata: {}, body: normalized.trim() };
	}

	const lines = normalized.split('\n');
	const end = lines.findIndex(
		(line, index) => index > 0 && line.trim() === '---',
	);
	if (end === -1) {
		return { metadata: {}, body: normalized.trim() };
	}

	const metadata: Record<string, string> = {};
	for (const line of lines.slice(1, end)) {
		const separator = line.indexOf(':');
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (!key) continue;
		metadata[key] = unquote_frontmatter_value(value);
	}

	return {
		metadata,
		body: lines
			.slice(end + 1)
			.join('\n')
			.trim(),
	};
}

export function read_prompt_presets_dir(
	path: string,
): PromptPresetMap {
	if (!existsSync(path)) return {};

	try {
		const presets: PromptPresetMap = {};
		for (const entry of readdirSync(path, { withFileTypes: true })
			.filter((item) => item.isFile() && item.name.endsWith('.md'))
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const name = entry.name.slice(0, -3).trim();
			if (!name) continue;
			const { metadata, body } = parse_prompt_preset_markdown(
				readFileSync(join(path, entry.name), 'utf-8'),
			);
			if (!body) continue;
			presets[name] = {
				kind: metadata.kind === 'layer' ? 'layer' : 'base',
				instructions: body,
				...(metadata.description
					? { description: metadata.description }
					: {}),
			};
		}
		return presets;
	} catch {
		return {};
	}
}

function format_prompt_preset_markdown(preset: PromptPreset): string {
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

export function load_prompt_presets(
	cwd: string,
): Record<string, LoadedPromptPreset> {
	return Object.assign(
		{},
		to_loaded_prompt_presets(DEFAULT_PROMPT_PRESETS, 'builtin'),
		to_loaded_prompt_presets(
			read_prompt_presets_file(get_global_presets_path()),
			'user',
		),
		to_loaded_prompt_presets(
			read_prompt_presets_dir(get_global_presets_dir()),
			'user',
		),
		...(should_load_project_prompt_presets()
			? [
					to_loaded_prompt_presets(
						read_prompt_presets_file(get_project_presets_path(cwd)),
						'project',
					),
					to_loaded_prompt_presets(
						read_prompt_presets_dir(get_project_presets_dir(cwd)),
						'project',
					),
				]
			: []),
	);
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
	if (!existsSync(path)) {
		return { version: 1, projects: {} };
	}

	try {
		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
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

	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(
		tmp,
		JSON.stringify(
			{
				version: 1,
				projects: Object.fromEntries(
					Object.entries(persisted.projects).sort(([a], [b]) =>
						a.localeCompare(b),
					),
				),
			},
			null,
			'\t',
		) + '\n',
		{ mode: 0o600 },
	);
	renameSync(tmp, path);
	return path;
}
