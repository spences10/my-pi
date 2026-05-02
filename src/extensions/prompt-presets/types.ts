export type PromptPresetKind = 'base' | 'layer';
export type PromptPresetSource = 'builtin' | 'user' | 'project';

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
