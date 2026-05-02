import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import type { SettingItem } from '@mariozechner/pi-tui';
import { show_settings_modal } from '@spences10/pi-tui-modal';
import { existsSync } from 'node:fs';
import {
	format_active_details,
	format_summary,
	get_prompt_source_label,
	list_base_presets,
	list_layer_presets,
} from './catalog.js';
import {
	DEFAULT_BASE_PROMPT_PRESET_NAME,
	DEFAULT_PROMPT_PRESETS,
} from './defaults.js';
import { set_status } from './footer.js';
import {
	get_global_presets_dir,
	get_project_presets_dir,
	get_prompt_preset_file_path,
	load_persisted_prompt_state,
	load_prompt_presets,
	remove_project_prompt_preset,
	save_global_prompt_preset_file,
	save_persisted_prompt_state,
	save_project_prompt_preset_file,
	save_prompt_preset_file,
} from './storage.js';
import type {
	LoadedPromptPreset,
	PromptPresetKind,
	PromptPresetState,
} from './types.js';

export {
	DEFAULT_BASE_PROMPT_PRESET_NAME,
	DEFAULT_PROMPT_PRESETS,
} from './defaults.js';
export {
	get_current_thinking_level,
	get_default_footer_thinking_level,
	render_footer_status_line,
} from './footer.js';
export {
	load_persisted_prompt_state,
	load_prompt_presets,
	merge_prompt_presets,
	normalize_prompt_presets,
	read_prompt_presets_dir,
	remove_project_prompt_preset,
	save_persisted_prompt_state,
	save_project_prompt_presets,
	save_prompt_preset_file,
} from './storage.js';
export type {
	LoadedPromptPreset,
	PromptPreset,
	PromptPresetKind,
	PromptPresetMap,
	PromptPresetSource,
	PromptPresetState,
} from './types.js';

const PRESET_STATE_TYPE = 'prompt-preset-state';
const ENABLED = '● enabled';
const DISABLED = '○ disabled';
const SELECTED = '● selected';
const UNSELECTED = '○';
const NONE_BASE_ID = '__base_none__';

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

	for (const command_name of ['prompt-preset', 'preset']) {
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
