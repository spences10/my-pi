export type PromptPresetKind = 'base' | 'layer';
export type PromptPresetSource = 'builtin' | 'user' | 'project';
export type PromptPresetOrigin =
	| 'builtin'
	| 'legacy-global-settings'
	| 'global-markdown'
	| 'project-json'
	| 'project-markdown';

export interface PromptPreset {
	kind?: PromptPresetKind;
	description?: string;
	instructions: string;
}

export type PromptPresetMap = Record<string, PromptPreset>;

export interface LoadedPromptPreset extends PromptPreset {
	name: string;
	kind: PromptPresetKind;
	/** Broad scope retained for UI compatibility. */
	source: PromptPresetSource;
	/** Exact owner used for precedence, diagnostics, and later UI work. */
	origin: PromptPresetOrigin;
	path: string | null;
	editable: boolean;
	/** Lower-precedence definitions, nearest fallback first. */
	fallbacks: PromptPresetDefinition[];
}

export interface PromptPresetDefinition extends PromptPreset {
	name: string;
	kind: PromptPresetKind;
	source: PromptPresetSource;
	origin: PromptPresetOrigin;
	path: string | null;
	editable: boolean;
}

export interface PromptPresetDiagnostic {
	code:
		| 'shadowed'
		| 'invalid-source'
		| 'migration-collision'
		| 'migration-unsafe-name';
	name?: string;
	message: string;
	path: string | null;
	origin: PromptPresetOrigin;
}

export interface PromptPresetCatalog {
	presets: Record<string, LoadedPromptPreset>;
	diagnostics: PromptPresetDiagnostic[];
}

export interface PromptPresetMigrationResult {
	scope: 'global' | 'project';
	written: string[];
	collisions: PromptPresetDiagnostic[];
	legacy_path: string;
	remaining_legacy: number;
}

export interface PromptPresetState {
	base_name: string | null;
	layer_names: string[];
}
