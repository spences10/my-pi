import {
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from '@mariozechner/pi-ai';
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ReadonlyFooterDataProvider,
} from '@mariozechner/pi-coding-agent';
import {
	truncateToWidth,
	visibleWidth,
	type SettingItem,
} from '@mariozechner/pi-tui';
import { show_settings_modal } from '@spences10/pi-tui-modal';
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

export type PromptPresetKind = 'base' | 'layer';
export type PromptPresetSource = 'builtin' | 'user' | 'project';

const PROJECT_PROMPT_PRESETS_ENV = 'MY_PI_PROMPT_PRESETS_PROJECT';

export interface PromptPreset {
	kind?: PromptPresetKind;
	description?: string;
	instructions: string;
}

export type PromptPresetMap = Record<string, PromptPreset>;

export interface LoadedPromptPreset extends PromptPreset {
	name: string;
	kind: PromptPresetKind;
	source: PromptPresetSource;
}

export interface PromptPresetState {
	base_name: string | null;
	layer_names: string[];
}

interface PersistedPromptPresetStates {
	version: number;
	projects: Record<string, PromptPresetState>;
}

const PRESET_STATE_TYPE = 'prompt-preset-state';
export const DEFAULT_BASE_PROMPT_PRESET_NAME = 'terse';
const ENABLED = '● enabled';
const DISABLED = '○ disabled';
const SELECTED = '● selected';
const UNSELECTED = '○';
const NONE_BASE_ID = '__base_none__';

export const DEFAULT_PROMPT_PRESETS: PromptPresetMap = {
	terse: {
		kind: 'base',
		description: 'Short, direct, no fluff',
		instructions:
			"Be concise and direct. Default to the shortest response that fully solves the user's request. Use at most one short paragraph or 3 bullets unless the user explicitly asks for detail. For implementation reports, include only what changed, validation, and the next step if relevant. No purple prose, no filler, no repetitive caveats.",
	},
	standard: {
		kind: 'base',
		description: 'Clear and concise with key context',
		instructions:
			'Be clear, direct, and concise. Include only the reasoning and implementation details that matter. Avoid filler, grandstanding, and ornamental language. Use bullets when they improve scanability.',
	},
	detailed: {
		kind: 'base',
		description: 'More explanation when nuance matters',
		instructions:
			'Be thorough when the task is complex or tradeoffs matter, but stay practical. Explain only the details that help the user decide, verify, or implement. Avoid purple prose and unnecessary scene-setting.',
	},
	'no-purple-prose': {
		kind: 'layer',
		description: 'Strip out ornamental language',
		instructions:
			'Do not use purple prose, flourish, motivational filler, or theatrical transitions. Prefer plain language and concrete statements.',
	},
	bullets: {
		kind: 'layer',
		description: 'Prefer short bullets when useful',
		instructions:
			'When presenting options, findings, or steps, prefer short bullet lists over long paragraphs.',
	},
	'clarify-first': {
		kind: 'layer',
		description:
			'Ask brief clarifying questions when requirements are ambiguous',
		instructions:
			'If the request is materially ambiguous, ask the minimum clarifying question(s) needed before proceeding. Do not ask unnecessary questions.',
	},
	'include-risks': {
		kind: 'layer',
		description: 'Call out notable risks or tradeoffs',
		instructions:
			'When making a recommendation or implementation plan, briefly mention the key risk, tradeoff, or caveat if one materially matters.',
	},
};

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

function get_global_presets_dir(): string {
	return join(getAgentDir(), 'presets');
}

function get_project_presets_dir(cwd: string): string {
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

function get_prompt_preset_file_path(
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

function save_project_prompt_preset_file(
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

function save_global_prompt_preset_file(
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

function get_last_preset_state(
	ctx: ExtensionContext,
): PromptPresetState | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as {
			type?: string;
			customType?: string;
			data?: PromptPresetState;
		};
		if (
			entry.type === 'custom' &&
			entry.customType === PRESET_STATE_TYPE &&
			entry.data
		) {
			return entry.data;
		}
	}
	return undefined;
}

function sets_equal(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

function get_prompt_source_label(source: PromptPresetSource): string {
	switch (source) {
		case 'builtin':
			return 'built-in';
		case 'user':
			return 'user';
		case 'project':
			return 'project';
	}
}

function list_base_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'base')
		.sort((a, b) => a.name.localeCompare(b.name));
}

function list_layer_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'layer')
		.sort((a, b) => a.name.localeCompare(b.name));
}

function format_summary(
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
	presets: Record<string, LoadedPromptPreset>,
): string {
	const lines = [`Base: ${active_base_name ?? '(none)'}`];

	const layer_names = [...active_layers].sort();
	if (layer_names.length === 0) {
		lines.push('Layers: (none)');
	} else {
		lines.push('Layers:');
		for (const name of layer_names) {
			const preset = presets[name];
			const description = preset?.description
				? ` — ${preset.description}`
				: '';
			lines.push(`- ${name}${description}`);
		}
	}

	return lines.join('\n');
}

function format_active_details(
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
	presets: Record<string, LoadedPromptPreset>,
): string {
	const parts: string[] = [];

	if (active_base_name) {
		const base = presets[active_base_name];
		if (base) {
			parts.push(`Base: ${base.name}`);
			if (base.description)
				parts.push(`Description: ${base.description}`);
			parts.push(`Source: ${get_prompt_source_label(base.source)}`);
			parts.push('', base.instructions.trim());
		}
	}

	const layer_names = [...active_layers].sort();
	if (layer_names.length > 0) {
		if (parts.length > 0) parts.push('', '---', '');
		parts.push('Layers:');
		for (const name of layer_names) {
			const layer = presets[name];
			if (!layer) continue;
			parts.push(
				`- ${layer.name} (${get_prompt_source_label(layer.source)})`,
			);
			if (layer.description) parts.push(`  ${layer.description}`);
		}
	}

	return parts.join('\n') || 'No preset or layers active';
}

function get_footer_prompt_status(
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): string | undefined {
	if (!active_base_name && active_layers.size === 0) {
		return undefined;
	}

	const label = active_base_name ?? 'none';
	const layer_suffix =
		active_layers.size > 0 ? ` +${active_layers.size}` : '';
	return `prompt:${label}${layer_suffix}`;
}

function sanitize_status_text(text: string): string {
	return text
		.replace(/[\r\n\t]/g, ' ')
		.replace(/ +/g, ' ')
		.trim();
}

function format_token_count(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function render_footer_status_line(
	theme: ExtensionContext['ui']['theme'],
	width: number,
	left_items: string[],
	right_item?: string,
): string | undefined {
	const left = sanitize_status_text(left_items.join(' '));
	const right = right_item ? sanitize_status_text(right_item) : '';
	if (!left && !right) return undefined;
	if (!right) {
		return truncateToWidth(
			theme.fg('dim', left),
			width,
			theme.fg('dim', '...'),
		);
	}
	if (!left) {
		const themed_right = theme.fg('dim', right);
		const right_width = visibleWidth(themed_right);
		return right_width >= width
			? truncateToWidth(themed_right, width, theme.fg('dim', '...'))
			: `${' '.repeat(width - right_width)}${themed_right}`;
	}

	const right_width = visibleWidth(right);
	if (right_width >= width) {
		return truncateToWidth(
			theme.fg('dim', right),
			width,
			theme.fg('dim', '...'),
		);
	}

	const min_gap = 1;
	const available_left = Math.max(0, width - right_width - min_gap);
	const truncated_left = truncateToWidth(left, available_left, '...');
	const left_width = visibleWidth(truncated_left);
	const gap = Math.max(min_gap, width - left_width - right_width);
	return (
		theme.fg('dim', truncated_left) +
		' '.repeat(gap) +
		theme.fg('dim', right)
	);
}

const VALID_THINKING_LEVELS = new Set<ModelThinkingLevel>([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
]);

function is_model_thinking_level(
	level: string,
): level is ModelThinkingLevel {
	return VALID_THINKING_LEVELS.has(level as ModelThinkingLevel);
}

export function get_default_footer_thinking_level(
	model: ExtensionContext['model'],
): ModelThinkingLevel {
	if (!model?.reasoning) return 'off';
	return clampThinkingLevel(model, 'medium');
}

export function get_current_thinking_level(
	ctx: Pick<ExtensionContext, 'model' | 'sessionManager'>,
): ModelThinkingLevel {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as {
			type?: string;
			thinkingLevel?: string;
		};
		if (
			entry.type === 'thinking_level_change' &&
			typeof entry.thinkingLevel === 'string' &&
			is_model_thinking_level(entry.thinkingLevel)
		) {
			if (!ctx.model?.reasoning) return 'off';
			return getSupportedThinkingLevels(ctx.model).includes(
				entry.thinkingLevel,
			)
				? entry.thinkingLevel
				: clampThinkingLevel(ctx.model, entry.thinkingLevel);
		}
	}
	return get_default_footer_thinking_level(ctx.model);
}

function render_footer_lines(
	ctx: ExtensionContext,
	theme: ExtensionContext['ui']['theme'],
	footer_data: ReadonlyFooterDataProvider,
	width: number,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): string[] {
	let total_input = 0;
	let total_output = 0;
	let total_cache_read = 0;
	let total_cache_write = 0;
	let total_cost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (
			entry.type === 'message' &&
			entry.message.role === 'assistant'
		) {
			total_input += entry.message.usage.input;
			total_output += entry.message.usage.output;
			total_cache_read += entry.message.usage.cacheRead;
			total_cache_write += entry.message.usage.cacheWrite;
			total_cost += entry.message.usage.cost.total;
		}
	}

	const context_usage = ctx.getContextUsage();
	const context_window =
		context_usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const context_percent_value = context_usage?.percent ?? 0;
	const context_percent =
		context_usage?.percent !== null
			? context_percent_value.toFixed(1)
			: '?';

	let pwd = ctx.cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) {
		pwd = `~${pwd.slice(home.length)}`;
	}

	const branch = footer_data.getGitBranch();
	if (branch) {
		pwd = `${pwd} (${branch})`;
	}

	const session_name = ctx.sessionManager.getSessionName();
	if (session_name) {
		pwd = `${pwd} • ${session_name}`;
	}

	const stats_parts: string[] = [];
	if (total_input)
		stats_parts.push(`↑${format_token_count(total_input)}`);
	if (total_output)
		stats_parts.push(`↓${format_token_count(total_output)}`);
	if (total_cache_read)
		stats_parts.push(`R${format_token_count(total_cache_read)}`);
	if (total_cache_write)
		stats_parts.push(`W${format_token_count(total_cache_write)}`);

	const using_subscription = ctx.model
		? ctx.modelRegistry.isUsingOAuth(ctx.model)
		: false;
	if (total_cost || using_subscription) {
		stats_parts.push(
			`$${total_cost.toFixed(3)}${using_subscription ? ' (sub)' : ''}`,
		);
	}

	const context_percent_display =
		context_percent === '?'
			? `?/${format_token_count(context_window)}`
			: `${context_percent}%/${format_token_count(context_window)}`;
	let context_percent_str = context_percent_display;
	if (context_percent_value > 90) {
		context_percent_str = theme.fg('error', context_percent_display);
	} else if (context_percent_value > 70) {
		context_percent_str = theme.fg(
			'warning',
			context_percent_display,
		);
	}
	stats_parts.push(context_percent_str);

	let stats_left = stats_parts.join(' ');
	let stats_left_width = visibleWidth(stats_left);
	if (stats_left_width > width) {
		stats_left = truncateToWidth(stats_left, width, '...');
		stats_left_width = visibleWidth(stats_left);
	}

	const model_name = ctx.model?.id || 'no-model';
	const thinking_level = get_current_thinking_level(ctx);
	let right_side_without_provider = model_name;
	if (ctx.model?.reasoning) {
		right_side_without_provider =
			thinking_level === 'off'
				? `${model_name} • thinking off`
				: `${model_name} • ${thinking_level}`;
	}

	let right_side = right_side_without_provider;
	if (footer_data.getAvailableProviderCount() > 1 && ctx.model) {
		right_side = `(${ctx.model.provider}) ${right_side_without_provider}`;
		if (stats_left_width + 2 + visibleWidth(right_side) > width) {
			right_side = right_side_without_provider;
		}
	}

	const right_side_width = visibleWidth(right_side);
	const total_needed = stats_left_width + 2 + right_side_width;
	let stats_line: string;
	if (total_needed <= width) {
		const padding = ' '.repeat(
			width - stats_left_width - right_side_width,
		);
		stats_line = stats_left + padding + right_side;
	} else {
		const available_for_right = width - stats_left_width - 2;
		if (available_for_right > 0) {
			const truncated_right = truncateToWidth(
				right_side,
				available_for_right,
				'',
			);
			const truncated_right_width = visibleWidth(truncated_right);
			const padding = ' '.repeat(
				Math.max(0, width - stats_left_width - truncated_right_width),
			);
			stats_line = stats_left + padding + truncated_right;
		} else {
			stats_line = stats_left;
		}
	}

	const dim_stats_left = theme.fg('dim', stats_left);
	const remainder = stats_line.slice(stats_left.length);
	const dim_remainder = theme.fg('dim', remainder);
	const lines = [
		truncateToWidth(
			theme.fg('dim', pwd),
			width,
			theme.fg('dim', '...'),
		),
		dim_stats_left + dim_remainder,
	];

	const prompt_status = get_footer_prompt_status(
		active_base_name,
		active_layers,
	);

	const other_statuses = Array.from(
		footer_data.getExtensionStatuses().entries(),
	)
		.filter(([key]) => key !== 'preset')
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitize_status_text(text));
	const combined_status_line = render_footer_status_line(
		theme,
		width,
		other_statuses,
		prompt_status,
	);
	if (combined_status_line) {
		lines.push(combined_status_line);
	}

	return lines;
}

function set_status(
	ctx: ExtensionContext,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): void {
	ctx.ui.setStatus('preset', undefined);
	if (!ctx.hasUI) return;
	ctx.ui.setFooter((tui, theme, footer_data) => {
		const unsubscribe = footer_data.onBranchChange(() =>
			tui.requestRender(),
		);
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number) {
				return render_footer_lines(
					ctx,
					theme,
					footer_data,
					width,
					active_base_name,
					active_layers,
				);
			},
		};
	});
}

function persist_state(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): void {
	const state = {
		base_name: active_base_name ?? null,
		layer_names: [...active_layers].sort(),
	};
	pi.appendEntry(PRESET_STATE_TYPE, state);
	save_persisted_prompt_state(ctx.cwd, state);
}

function normalize_active_state(
	presets: Record<string, LoadedPromptPreset>,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): {
	active_base_name: string | undefined;
	active_layers: Set<string>;
} {
	const next_base_name =
		active_base_name && presets[active_base_name]?.kind === 'base'
			? active_base_name
			: undefined;
	const next_layers = new Set(
		[...active_layers].filter(
			(name) => presets[name]?.kind === 'layer',
		),
	);
	return {
		active_base_name: next_base_name,
		active_layers: next_layers,
	};
}

function parse_preset_flag(flag: string): string[] {
	return flag
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function is_subcommand(command: string): boolean {
	return [
		'help',
		'list',
		'show',
		'clear',
		'edit',
		'edit-global',
		'export-defaults',
		'delete',
		'reset',
		'reload',
		'base',
		'enable',
		'disable',
		'toggle',
	].includes(command);
}

function format_prompt_preset_help(): string {
	return `Prompt presets append instructions to the system prompt.

Commands:
- /prompt-preset                Open the preset picker
- /prompt-preset show           Show the active base and layers
- /prompt-preset <name>         Activate a base preset or toggle a layer
- /prompt-preset base <name>    Activate a base preset
- /prompt-preset enable <layer> Enable a layer
- /prompt-preset disable <layer> Disable a layer
- /prompt-preset edit <name>    Edit/create .pi/presets/<name>.md
- /prompt-preset edit-global <name> Edit/create ~/.pi/agent/presets/<name>.md
- /prompt-preset export-defaults Export built-ins to ~/.pi/agent/presets/*.md
- /prompt-preset export-defaults project Export built-ins to .pi/presets/*.md
- /prompt-preset reload         Reload presets after manual file edits
- /prompt-preset clear          Clear active base and layers

Examples:
- /prompt-preset export-defaults
- /prompt-preset edit-global terse
- /prompt-preset base detailed
- /prompt-preset enable bullets
- /prompt-preset show

Alias: /preset`;
}

export default async function prompt_presets(pi: ExtensionAPI) {
	let presets: Record<string, LoadedPromptPreset> = {};
	let active_base_name: string | undefined;
	let active_layers = new Set<string>();

	function get_base(
		name: string | undefined,
	): LoadedPromptPreset | undefined {
		return name ? presets[name] : undefined;
	}

	function get_layer(name: string): LoadedPromptPreset | undefined {
		const preset = presets[name];
		return preset?.kind === 'layer' ? preset : undefined;
	}

	function commit_state(
		ctx: ExtensionContext,
		next_base_name: string | undefined,
		next_layers: ReadonlySet<string>,
		options?: { persist?: boolean; notify?: string },
	): void {
		active_base_name = next_base_name;
		active_layers = new Set(next_layers);
		set_status(ctx, active_base_name, active_layers);
		if (options?.persist !== false) {
			persist_state(pi, ctx, active_base_name, active_layers);
		}
		if (options?.notify) {
			ctx.ui.notify(options.notify, 'info');
		}
	}

	function activate_base(
		name: string | undefined,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		if (!name) {
			commit_state(ctx, undefined, active_layers, {
				persist: options?.persist,
				notify: 'Base preset cleared',
			});
			return true;
		}

		const preset = get_base(name);
		if (!preset) {
			ctx.ui.notify(`Unknown base preset: ${name}`, 'warning');
			return false;
		}

		commit_state(ctx, preset.name, active_layers, {
			persist: options?.persist,
			notify: `Base preset "${preset.name}" activated`,
		});
		return true;
	}

	function set_layer_enabled(
		name: string,
		enabled: boolean,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		const preset = get_layer(name);
		if (!preset) {
			ctx.ui.notify(`Unknown prompt layer: ${name}`, 'warning');
			return false;
		}

		const next_layers = new Set(active_layers);
		if (enabled) {
			next_layers.add(preset.name);
		} else {
			next_layers.delete(preset.name);
		}

		commit_state(ctx, active_base_name, next_layers, {
			persist: options?.persist,
			notify: enabled
				? `Layer "${preset.name}" enabled`
				: `Layer "${preset.name}" disabled`,
		});
		return true;
	}

	function toggle_layer(
		name: string,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		return set_layer_enabled(
			name,
			!active_layers.has(name),
			ctx,
			options,
		);
	}

	async function edit_preset(
		name: string,
		ctx: ExtensionCommandContext,
		scope: 'project' | 'global' = 'project',
	): Promise<void> {
		const existing = presets[name];
		const kind_choice = await ctx.ui.select('Preset kind', [
			existing?.kind === 'layer'
				? 'layer (current)'
				: 'base (current)',
			existing?.kind === 'layer' ? 'base' : 'layer',
		]);
		if (!kind_choice) return;
		const kind: PromptPresetKind = kind_choice.startsWith('layer')
			? 'layer'
			: 'base';

		const description = await ctx.ui.input(
			`Description for ${name}`,
			existing?.description ?? '',
		);
		if (description === undefined) return;

		const instructions = await ctx.ui.editor(
			`Edit ${kind} preset: ${name}`,
			existing?.instructions ?? '',
		);
		if (instructions === undefined) return;

		const saved_path =
			scope === 'global'
				? save_global_prompt_preset_file(name, {
						kind,
						instructions,
						...(description.trim()
							? { description: description.trim() }
							: {}),
					})
				: save_project_prompt_preset_file(ctx.cwd, name, {
						kind,
						instructions,
						...(description.trim()
							? { description: description.trim() }
							: {}),
					});

		presets = load_prompt_presets(ctx.cwd);
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;

		if (kind === 'base') {
			activate_base(name, ctx);
		} else {
			set_layer_enabled(name, true, ctx);
		}
		ctx.ui.notify(`Saved preset "${name}" to ${saved_path}`, 'info');
	}

	function export_default_presets(
		ctx: ExtensionCommandContext,
		scope: 'project' | 'global',
	): void {
		const dir =
			scope === 'global'
				? get_global_presets_dir()
				: get_project_presets_dir(ctx.cwd);
		let written = 0;
		let skipped = 0;
		for (const [name, preset] of Object.entries(
			DEFAULT_PROMPT_PRESETS,
		)) {
			const path = get_prompt_preset_file_path(dir, name);
			if (existsSync(path)) {
				skipped += 1;
				continue;
			}
			save_prompt_preset_file(dir, name, preset);
			written += 1;
		}

		presets = load_prompt_presets(ctx.cwd);
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;
		set_status(ctx, active_base_name, active_layers);

		ctx.ui.notify(
			`Exported ${written} built-in preset file(s) to ${dir}${skipped ? ` (${skipped} already existed)` : ''}`,
			'info',
		);
	}

	function remove_custom_preset(
		name: string,
		ctx: ExtensionCommandContext,
		mode: 'delete' | 'reset',
	): void {
		const result = remove_project_prompt_preset(ctx.cwd, name);
		if (!result.removed) {
			ctx.ui.notify(
				`No project-local preset named "${name}" to ${mode}`,
				'warning',
			);
			return;
		}

		presets = load_prompt_presets(ctx.cwd);
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;
		set_status(ctx, active_base_name, active_layers);
		persist_state(pi, ctx, active_base_name, active_layers);

		const fallback = presets[name];
		if (mode === 'reset' && fallback) {
			ctx.ui.notify(
				`Reset "${name}" to ${get_prompt_source_label(fallback.source)} preset`,
				'info',
			);
			return;
		}

		ctx.ui.notify(
			result.remaining === 0
				? `Removed "${name}" and deleted ${result.path}`
				: `Removed "${name}" from ${result.path}`,
			'info',
		);
	}

	async function show_manager(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const base_presets = list_base_presets(presets);
		const layer_presets = list_layer_presets(presets);
		if (base_presets.length === 0 && layer_presets.length === 0) {
			ctx.ui.notify('No prompt presets available', 'warning');
			return;
		}

		const initial_base = active_base_name;
		const initial_layers = new Set(active_layers);
		let selected_base = active_base_name;
		const enabled_layers = new Set(active_layers);

		const items: SettingItem[] = [];
		const base_ids = new Set<string>();
		const layer_ids = new Set<string>();

		items.push({
			id: '__header_base__',
			label: `── Base presets (${base_presets.length + 1}) ──`,
			description: '',
			currentValue: '',
		});
		items.push({
			id: NONE_BASE_ID,
			label: '(none)',
			description: 'No active base preset',
			currentValue: UNSELECTED,
			values: [SELECTED, UNSELECTED],
		});
		base_ids.add(NONE_BASE_ID);

		for (const preset of base_presets) {
			items.push({
				id: preset.name,
				label: preset.name,
				description: [
					`${get_prompt_source_label(preset.source)} • ${preset.description ?? 'base preset'}`,
				].join('\n'),
				currentValue: UNSELECTED,
				values: [SELECTED, UNSELECTED],
			});
			base_ids.add(preset.name);
		}

		items.push({
			id: '__header_layers__',
			label: `── Prompt layers (${layer_presets.length}) ──`,
			description: '',
			currentValue: '',
		});
		for (const preset of layer_presets) {
			items.push({
				id: preset.name,
				label: preset.name,
				description: [
					`${get_prompt_source_label(preset.source)} • ${preset.description ?? 'layer'}`,
				].join('\n'),
				currentValue: DISABLED,
				values: [ENABLED, DISABLED],
			});
			layer_ids.add(preset.name);
		}

		function sync_values() {
			for (const item of items) {
				if (base_ids.has(item.id)) {
					const is_selected =
						(item.id === NONE_BASE_ID && !selected_base) ||
						item.id === selected_base;
					item.currentValue = is_selected ? SELECTED : UNSELECTED;
				} else if (layer_ids.has(item.id)) {
					item.currentValue = enabled_layers.has(item.id)
						? ENABLED
						: DISABLED;
				}
			}
		}

		sync_values();

		await show_settings_modal(ctx, {
			title: 'Prompt presets',
			subtitle: () =>
				`base: ${selected_base ?? '(none)'} • ${enabled_layers.size} layer(s) enabled`,
			items,
			max_visible: Math.min(Math.max(items.length + 4, 8), 24),
			enable_search: true,
			on_change: (id, new_value) => {
				if (id.startsWith('__header_')) return;

				if (base_ids.has(id)) {
					selected_base =
						new_value === SELECTED && id !== NONE_BASE_ID
							? id
							: undefined;
					sync_values();
					return;
				}

				if (layer_ids.has(id)) {
					if (new_value === ENABLED) {
						enabled_layers.add(id);
					} else {
						enabled_layers.delete(id);
					}
					sync_values();
				}
			},
		});

		if (
			selected_base !== initial_base ||
			!sets_equal(initial_layers, enabled_layers)
		) {
			commit_state(ctx, selected_base, enabled_layers, {
				notify: 'Updated prompt preset selection',
			});
		}
	}

	pi.registerFlag('preset', {
		description:
			'Activate prompt config on startup. Accepts a base preset or comma-separated preset/layer names.',
		type: 'string',
	});

	const prompt_preset_command: Parameters<
		ExtensionAPI['registerCommand']
	>[1] = {
		description:
			'Manage prompt presets and layers. Try: /prompt-preset help, /prompt-preset export-defaults, /prompt-preset edit-global terse',
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			const parts = trimmed ? trimmed.split(/\s+/) : [];
			const base_names = list_base_presets(presets).map(
				(preset) => preset.name,
			);
			const layer_names = list_layer_presets(presets).map(
				(preset) => preset.name,
			);
			const all_names = [...base_names, ...layer_names];

			if (parts.length <= 1) {
				const query = parts[0] ?? '';
				const subcommands = [
					'help',
					'list',
					'show',
					'clear',
					'edit',
					'edit-global',
					'export-defaults',
					'delete',
					'reset',
					'reload',
					'base',
					'enable',
					'disable',
					'toggle',
				];
				return [
					...subcommands
						.filter((item) => item.startsWith(query))
						.map((item) => ({ value: item, label: item })),
					...all_names
						.filter((item) => item.startsWith(query))
						.map((item) => ({ value: item, label: item })),
				];
			}

			const command = parts[0];
			const query = parts.slice(1).join(' ');
			if (command === 'base') {
				return base_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({ value: `base ${item}`, label: item }));
			}
			if (['enable', 'disable', 'toggle'].includes(command)) {
				return layer_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({
						value: `${command} ${item}`,
						label: item,
					}));
			}
			if (command === 'edit' || command === 'edit-global') {
				return all_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({
						value: `${command} ${item}`,
						label: item,
					}));
			}
			if (['delete', 'reset'].includes(command)) {
				return all_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({
						value: `${command} ${item}`,
						label: item,
					}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				if (ctx.hasUI) {
					await show_manager(ctx);
					return;
				}
				ctx.ui.notify(
					format_summary(active_base_name, active_layers, presets),
					'info',
				);
				return;
			}

			const [first, ...rest] = trimmed.split(/\s+/);
			const arg = rest.join(' ').trim();

			switch (first) {
				case 'help':
					ctx.ui.notify(format_prompt_preset_help(), 'info');
					return;
				case 'list':
					ctx.ui.notify(
						format_summary(active_base_name, active_layers, presets),
						'info',
					);
					return;
				case 'show':
					ctx.ui.notify(
						format_active_details(
							active_base_name,
							active_layers,
							presets,
						),
						'info',
					);
					return;
				case 'clear':
					commit_state(ctx, undefined, new Set(), {
						notify: 'Cleared base preset and prompt layers',
					});
					return;
				case 'reload': {
					presets = load_prompt_presets(ctx.cwd);
					const normalized = normalize_active_state(
						presets,
						active_base_name,
						active_layers,
					);
					active_base_name = normalized.active_base_name;
					active_layers = normalized.active_layers;
					set_status(ctx, active_base_name, active_layers);
					ctx.ui.notify('Reloaded prompt presets', 'info');
					return;
				}
				case 'base':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset base <name> (alias: /preset)',
							'warning',
						);
						return;
					}
					activate_base(arg, ctx);
					return;
				case 'enable':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset enable <layer> (alias: /preset)',
							'warning',
						);
						return;
					}
					set_layer_enabled(arg, true, ctx);
					return;
				case 'disable':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset disable <layer> (alias: /preset)',
							'warning',
						);
						return;
					}
					set_layer_enabled(arg, false, ctx);
					return;
				case 'toggle':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset toggle <layer> (alias: /preset)',
							'warning',
						);
						return;
					}
					toggle_layer(arg, ctx);
					return;
				case 'edit': {
					let scope: 'project' | 'global' = 'project';
					let name = arg;
					if (arg.startsWith('--global ')) {
						scope = 'global';
						name = arg.slice('--global '.length).trim();
					} else if (arg.startsWith('--project ')) {
						name = arg.slice('--project '.length).trim();
					}
					if (!name) {
						ctx.ui.notify(
							'Usage: /prompt-preset edit [--global|--project] <name> (alias: /preset)',
							'warning',
						);
						return;
					}
					await edit_preset(name, ctx, scope);
					return;
				}
				case 'edit-global':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset edit-global <name> (alias: /preset)',
							'warning',
						);
						return;
					}
					await edit_preset(arg, ctx, 'global');
					return;
				case 'export-defaults': {
					const scope = arg || 'global';
					if (scope !== 'global' && scope !== 'project') {
						ctx.ui.notify(
							'Usage: /prompt-preset export-defaults [global|project] (alias: /preset)',
							'warning',
						);
						return;
					}
					export_default_presets(ctx, scope);
					return;
				}
				case 'delete':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset delete <name> (alias: /preset)',
							'warning',
						);
						return;
					}
					remove_custom_preset(arg, ctx, 'delete');
					return;
				case 'reset':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /prompt-preset reset <name> (alias: /preset)',
							'warning',
						);
						return;
					}
					remove_custom_preset(arg, ctx, 'reset');
					return;
			}

			if (is_subcommand(first)) {
				ctx.ui.notify(
					`Unsupported preset command: ${first}`,
					'warning',
				);
				return;
			}

			const preset = presets[trimmed];
			if (!preset) {
				ctx.ui.notify(
					`Unknown preset or layer: ${trimmed}. Try /prompt-preset help.`,
					'warning',
				);
				return;
			}
			if (preset.kind === 'base') {
				activate_base(preset.name, ctx);
			} else {
				toggle_layer(preset.name, ctx);
			}
		},
	};

	for (const command_name of [
		'prompt-preset',
		'prompt-presets',
		'preset',
	]) {
		pi.registerCommand(command_name, prompt_preset_command);
	}

	pi.on('session_start', async (_event, ctx) => {
		presets = load_prompt_presets(ctx.cwd);
		active_base_name = undefined;
		active_layers = new Set();

		const preset_flag = pi.getFlag('preset');
		if (typeof preset_flag === 'string' && preset_flag.trim()) {
			for (const name of parse_preset_flag(preset_flag)) {
				const preset = presets[name];
				if (!preset) continue;
				if (preset.kind === 'base') {
					active_base_name = name;
				} else {
					active_layers.add(name);
				}
			}
			const normalized = normalize_active_state(
				presets,
				active_base_name,
				active_layers,
			);
			active_base_name = normalized.active_base_name;
			active_layers = normalized.active_layers;
			set_status(ctx, active_base_name, active_layers);
			return;
		}

		const restored = get_last_preset_state(ctx) ??
			load_persisted_prompt_state(ctx.cwd) ?? {
				base_name: DEFAULT_BASE_PROMPT_PRESET_NAME,
				layer_names: [],
			};
		active_base_name = restored.base_name ?? undefined;
		active_layers = new Set(restored.layer_names ?? []);
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;
		set_status(ctx, active_base_name, active_layers);
	});

	pi.on('before_agent_start', async (event) => {
		const blocks: string[] = [];
		const base = get_base(active_base_name);
		if (base?.instructions.trim()) {
			blocks.push(
				`## Active Base Prompt: ${base.name}\n${base.instructions.trim()}`,
			);
		}

		const layer_blocks = [...active_layers]
			.sort()
			.map((name) => presets[name])
			.filter((preset): preset is LoadedPromptPreset =>
				Boolean(preset?.instructions.trim()),
			)
			.map(
				(preset) =>
					`### ${preset.name}\n${preset.instructions.trim()}`,
			);
		if (layer_blocks.length > 0) {
			blocks.push(
				`## Active Prompt Layers\n\n${layer_blocks.join('\n\n')}`,
			);
		}

		if (blocks.length === 0) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${blocks.join('\n\n')}`,
		};
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('preset', undefined);
		ctx.ui.setFooter(undefined);
	});
}
