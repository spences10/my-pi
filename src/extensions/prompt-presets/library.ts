import {
	existsSync,
	readdirSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
	get_global_presets_dir,
	get_project_presets_dir,
	get_prompt_preset_file_path,
	load_persisted_prompt_state,
	load_prompt_preset_catalog,
	save_persisted_prompt_state,
	save_prompt_preset_file,
} from './storage.js';
import type {
	LoadedPromptPreset,
	PromptPreset,
	PromptPresetCatalog,
	PromptPresetKind,
	PromptPresetState,
} from './types.js';

export type PromptPresetScope = 'global' | 'project';
export type PromptPresetLibraryErrorCode =
	| 'collision'
	| 'confirmation-required'
	| 'invalid-instructions'
	| 'invalid-kind'
	| 'invalid-name'
	| 'invalid-scope'
	| 'not-found'
	| 'project-disabled'
	| 'read-only'
	| 'source-mismatch';

export class PromptPresetLibraryError extends Error {
	constructor(
		public readonly code: PromptPresetLibraryErrorCode,
		message: string,
		public readonly details: Record<string, unknown> = {},
	) {
		super(message);
		this.name = 'PromptPresetLibraryError';
	}
}

export interface PromptPresetDeleteConfirmation {
	name: string;
	scope: PromptPresetScope;
	path: string;
	kind: PromptPresetKind;
	fallback: LoadedPromptPreset | undefined;
	active: boolean;
}

export interface PromptPresetMutationResult {
	preset: LoadedPromptPreset | undefined;
	catalog: PromptPresetCatalog;
	path: string;
	state?: PromptPresetState;
}

const PORTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_RESERVED_BASENAME =
	/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

function validate_scope(
	scope: string,
): asserts scope is PromptPresetScope {
	if (scope !== 'global' && scope !== 'project') {
		throw new PromptPresetLibraryError(
			'invalid-scope',
			`Invalid prompt preset scope: ${scope}`,
			{ scope },
		);
	}
}

function validate_kind(
	kind: string,
): asserts kind is PromptPresetKind {
	if (kind !== 'base' && kind !== 'layer') {
		throw new PromptPresetLibraryError(
			'invalid-kind',
			`Invalid prompt preset kind: ${kind}`,
			{ kind },
		);
	}
}

export function validate_prompt_preset_name(name: string): string {
	if (
		name !== name.trim() ||
		!PORTABLE_NAME_PATTERN.test(name) ||
		name.endsWith('.') ||
		WINDOWS_RESERVED_BASENAME.test(name)
	) {
		throw new PromptPresetLibraryError(
			'invalid-name',
			`Prompt preset name is not portable: ${JSON.stringify(name)}`,
			{ name },
		);
	}
	const path = get_prompt_preset_file_path('/presets', name);
	if (basename(path) !== `${name}.md`) {
		throw new PromptPresetLibraryError(
			'invalid-name',
			`Prompt preset name cannot round-trip to Markdown: ${name}`,
			{ name },
		);
	}
	return name;
}

function get_scope_dir(
	cwd: string,
	scope: PromptPresetScope,
): string {
	validate_scope(scope);
	if (
		scope === 'project' &&
		['0', 'false', 'no', 'skip', 'disable'].includes(
			process.env.MY_PI_PROMPT_PRESETS_PROJECT?.trim().toLowerCase() ??
				'',
		)
	) {
		throw new PromptPresetLibraryError(
			'project-disabled',
			'Project prompt presets are disabled for this repository',
			{ scope },
		);
	}
	return scope === 'global'
		? get_global_presets_dir()
		: get_project_presets_dir(cwd);
}

function get_scope_origin(scope: PromptPresetScope) {
	return scope === 'global' ? 'global-markdown' : 'project-markdown';
}

function assert_portable_path_available(
	dir: string,
	name: string,
	ignore_path?: string,
): string {
	const path = get_prompt_preset_file_path(dir, name);
	if (existsSync(dir)) {
		const collision = readdirSync(dir).find((entry) => {
			const candidate = join(dir, entry);
			return (
				candidate !== ignore_path &&
				entry.toLocaleLowerCase('en-US') ===
					`${name}.md`.toLocaleLowerCase('en-US')
			);
		});
		if (collision) {
			throw new PromptPresetLibraryError(
				'collision',
				`Prompt preset filename collides with ${collision}`,
				{ name, path: join(dir, collision) },
			);
		}
	}
	return path;
}

function find_scope_definition(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
): LoadedPromptPreset | undefined {
	const origin = get_scope_origin(scope);
	const loaded = load_prompt_preset_catalog(cwd).presets[name];
	if (loaded?.origin === origin) return loaded;
	return loaded?.fallbacks.find((item) => item.origin === origin) as
		| LoadedPromptPreset
		| undefined;
}

function normalize_preset(preset: PromptPreset): PromptPreset {
	const kind = preset.kind ?? 'base';
	validate_kind(kind);
	if (!preset.instructions.trim()) {
		throw new PromptPresetLibraryError(
			'invalid-instructions',
			'Prompt preset instructions cannot be empty',
		);
	}
	return {
		kind,
		instructions: preset.instructions,
		...(preset.description?.trim()
			? { description: preset.description.trim() }
			: {}),
	};
}

export function reload_prompt_preset_library(
	cwd: string,
): PromptPresetCatalog {
	return load_prompt_preset_catalog(cwd);
}

export function create_prompt_preset(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
	preset: PromptPreset,
): PromptPresetMutationResult {
	validate_scope(scope);
	validate_prompt_preset_name(name);
	const dir = get_scope_dir(cwd, scope);
	const path = assert_portable_path_available(dir, name);
	if (existsSync(path)) {
		throw new PromptPresetLibraryError(
			'collision',
			`Preset already exists: ${name}`,
			{
				name,
				path,
			},
		);
	}
	save_prompt_preset_file(dir, name, normalize_preset(preset));
	const catalog = reload_prompt_preset_library(cwd);
	return { preset: catalog.presets[name], catalog, path };
}

export function copy_prompt_preset(
	cwd: string,
	name: string,
	source_scope: PromptPresetScope | 'builtin',
	target_scope: PromptPresetScope,
	target_name = name,
): PromptPresetMutationResult {
	validate_prompt_preset_name(name);
	validate_prompt_preset_name(target_name);
	if (source_scope !== 'builtin') {
		validate_scope(source_scope);
		get_scope_dir(cwd, source_scope);
	}
	validate_scope(target_scope);
	const loaded = load_prompt_preset_catalog(cwd).presets[name];
	const chain = loaded ? [loaded, ...loaded.fallbacks] : [];
	const source = chain.find((definition) => {
		if (source_scope === 'builtin') {
			return definition.origin === 'builtin';
		}
		return source_scope === 'global'
			? ['global-markdown', 'legacy-global-settings'].includes(
					definition.origin,
				)
			: ['project-markdown', 'project-json'].includes(
					definition.origin,
				);
	});
	if (!source) {
		throw new PromptPresetLibraryError(
			loaded ? 'source-mismatch' : 'not-found',
			loaded
				? `Preset ${name} has no ${source_scope} definition`
				: `Preset not found: ${name}`,
			{ name, source_scope },
		);
	}
	return create_prompt_preset(cwd, target_scope, target_name, source);
}

function require_custom_scope_definition(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
): LoadedPromptPreset {
	validate_prompt_preset_name(name);
	get_scope_dir(cwd, scope);
	const definition = find_scope_definition(cwd, scope, name);
	if (!definition?.path) {
		const winner = load_prompt_preset_catalog(cwd).presets[name];
		const code = !winner
			? 'not-found'
			: winner.origin === 'builtin'
				? 'read-only'
				: 'source-mismatch';
		throw new PromptPresetLibraryError(
			code,
			winner?.origin === 'builtin'
				? `Built-in preset is read-only: ${name}`
				: winner
					? `Preset ${name} is owned by ${winner.origin}, not ${scope} Markdown`
					: `No ${scope} Markdown preset found: ${name}`,
			{ name, scope, origin: winner?.origin },
		);
	}
	return definition;
}

function rename_state(
	state: PromptPresetState | undefined,
	old_name: string,
	new_name: string,
	kind: PromptPresetKind,
): PromptPresetState | undefined {
	if (!state) return undefined;
	return {
		base_name:
			kind === 'base' && state.base_name === old_name
				? new_name
				: state.base_name,
		layer_names:
			kind === 'layer'
				? [
						...new Set(
							state.layer_names.map((name) =>
								name === old_name ? new_name : name,
							),
						),
					].sort()
				: state.layer_names,
	};
}

export function rename_prompt_preset(
	cwd: string,
	scope: PromptPresetScope,
	old_name: string,
	new_name: string,
	active_state?: PromptPresetState,
): PromptPresetMutationResult {
	const definition = require_custom_scope_definition(
		cwd,
		scope,
		old_name,
	);
	validate_prompt_preset_name(new_name);
	const dir = get_scope_dir(cwd, scope);
	const old_path = definition.path!;
	const new_path = assert_portable_path_available(
		dir,
		new_name,
		old_path,
	);
	if (existsSync(new_path) && new_path !== old_path) {
		throw new PromptPresetLibraryError(
			'collision',
			`Preset already exists: ${new_name}`,
		);
	}
	const persisted = load_persisted_prompt_state(cwd);
	const next_persisted = rename_state(
		persisted,
		old_name,
		new_name,
		definition.kind,
	);
	const next_active = rename_state(
		active_state,
		old_name,
		new_name,
		definition.kind,
	);
	renameSync(old_path, new_path);
	try {
		if (next_persisted)
			save_persisted_prompt_state(cwd, next_persisted);
	} catch (error) {
		renameSync(new_path, old_path);
		throw error;
	}
	const catalog = reload_prompt_preset_library(cwd);
	return {
		preset: catalog.presets[new_name],
		catalog,
		path: new_path,
		...(next_active ? { state: next_active } : {}),
	};
}

export function get_delete_prompt_preset_confirmation(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
	state = load_persisted_prompt_state(cwd),
): PromptPresetDeleteConfirmation {
	const definition = require_custom_scope_definition(
		cwd,
		scope,
		name,
	);
	const winner = load_prompt_preset_catalog(cwd).presets[name];
	const fallback =
		winner?.origin === get_scope_origin(scope)
			? (winner.fallbacks[0] as LoadedPromptPreset | undefined)
			: winner;
	return {
		name,
		scope,
		path: definition.path!,
		kind: definition.kind,
		fallback,
		active:
			state?.base_name === name ||
			state?.layer_names.includes(name) === true,
	};
}

export function delete_prompt_preset(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
	confirmed = false,
): PromptPresetMutationResult {
	const confirmation = get_delete_prompt_preset_confirmation(
		cwd,
		scope,
		name,
	);
	if (!confirmed) {
		throw new PromptPresetLibraryError(
			'confirmation-required',
			`Confirmation required to delete ${name}`,
			{ confirmation },
		);
	}
	unlinkSync(confirmation.path);
	const catalog = reload_prompt_preset_library(cwd);
	return {
		preset: catalog.presets[name],
		catalog,
		path: confirmation.path,
	};
}

export function reset_prompt_preset_override(
	cwd: string,
	scope: PromptPresetScope,
	name: string,
): PromptPresetMutationResult {
	const definition = require_custom_scope_definition(
		cwd,
		scope,
		name,
	);
	unlinkSync(definition.path!);
	const catalog = reload_prompt_preset_library(cwd);
	return {
		preset: catalog.presets[name],
		catalog,
		path: definition.path!,
	};
}
