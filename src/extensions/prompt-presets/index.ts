import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import {
	format_active_details,
	format_summary,
	get_prompt_source_label,
} from './catalog.js';
import { get_prompt_preset_completions } from './completions.js';
import {
	DEFAULT_BASE_PROMPT_PRESET_NAME,
	DEFAULT_PROMPT_PRESETS,
} from './defaults.js';
import { set_status } from './footer.js';
import { format_prompt_preset_help, is_subcommand } from './help.js';
import { show_prompt_preset_manager } from './manager.js';
import { build_active_prompt_blocks } from './prompt-blocks.js';
import {
	get_last_preset_state,
	normalize_active_state,
	parse_preset_flag,
	persist_state,
} from './state.js';
import {
	format_prompt_preset_markdown,
	get_global_presets_dir,
	get_project_presets_dir,
	get_prompt_preset_file_path,
	load_persisted_prompt_state,
	load_prompt_presets,
	parse_prompt_preset_markdown,
	remove_project_prompt_preset,
	save_global_prompt_preset_file,
	save_project_prompt_preset_file,
	save_prompt_preset_file,
} from './storage.js';
import type {
	LoadedPromptPreset,
	PromptPresetKind,
} from './types.js';

export {
	get_current_thinking_level,
	get_default_footer_thinking_level,
	render_footer_status_line,
} from '@spences10/pi-footer';
export {
	DEFAULT_BASE_PROMPT_PRESET_NAME,
	DEFAULT_PROMPT_PRESETS,
} from './defaults.js';
export {
	copy_prompt_preset,
	create_prompt_preset,
	delete_prompt_preset,
	get_delete_prompt_preset_confirmation,
	PromptPresetLibraryError,
	reload_prompt_preset_library,
	rename_prompt_preset,
	reset_prompt_preset_override,
	validate_prompt_preset_name,
} from './library.js';
export type {
	PromptPresetDeleteConfirmation,
	PromptPresetLibraryErrorCode,
	PromptPresetMutationResult,
	PromptPresetScope,
} from './library.js';
export {
	load_persisted_prompt_state,
	load_prompt_preset_catalog,
	load_prompt_presets,
	merge_prompt_presets,
	migrate_legacy_prompt_presets,
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
	PromptPresetCatalog,
	PromptPresetDefinition,
	PromptPresetDiagnostic,
	PromptPresetKind,
	PromptPresetMap,
	PromptPresetMigrationResult,
	PromptPresetOrigin,
	PromptPresetSource,
	PromptPresetState,
} from './types.js';

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
		const dir =
			scope === 'global'
				? get_global_presets_dir()
				: get_project_presets_dir(ctx.cwd);
		const path = get_prompt_preset_file_path(dir, name);
		const initial_markdown = existsSync(path)
			? readFileSync(path, 'utf-8')
			: format_prompt_preset_markdown({
					kind: existing?.kind ?? 'layer',
					instructions: existing?.instructions ?? '',
					...(existing?.description
						? { description: existing.description }
						: {}),
				});

		const edited = await ctx.ui.editor(
			`Edit ${scope} preset markdown: ${name}`,
			initial_markdown,
		);
		if (edited === undefined) return;

		const { metadata, body } = parse_prompt_preset_markdown(edited);
		if (!body.trim()) {
			ctx.ui.notify('Preset instructions cannot be empty', 'warning');
			return;
		}
		const kind: PromptPresetKind =
			metadata.kind === 'base' ? 'base' : 'layer';
		const preset = {
			kind,
			instructions: body,
			...(typeof metadata.description === 'string' &&
			metadata.description.trim()
				? { description: metadata.description.trim() }
				: {}),
		};

		const saved_path =
			scope === 'global'
				? save_global_prompt_preset_file(name, preset)
				: save_project_prompt_preset_file(ctx.cwd, name, preset);

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
		await show_prompt_preset_manager(
			ctx,
			{ presets, active_base_name, active_layers },
			(selected_base, enabled_layers) => {
				commit_state(ctx, selected_base, enabled_layers, {
					notify: 'Updated prompt preset selection',
				});
			},
			async (name, scope) => {
				await edit_preset(name, ctx, scope);
			},
		);
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
		getArgumentCompletions: (prefix) =>
			get_prompt_preset_completions(presets, prefix),
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
		const blocks = build_active_prompt_blocks(
			presets,
			active_base_name,
			active_layers,
		);
		if (blocks.length === 0) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${blocks.join('\n\n')}`,
		};
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('preset', undefined);
	});
}
