import type {
	LoadedPromptPreset,
	PromptPresetSource,
} from './types.js';

export function get_prompt_source_label(
	source: PromptPresetSource,
): string {
	switch (source) {
		case 'builtin':
			return 'built-in';
		case 'user':
			return 'user';
		case 'project':
			return 'project';
	}
}

export function list_base_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'base')
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function list_layer_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'layer')
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function format_summary(
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

export function format_active_details(
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
