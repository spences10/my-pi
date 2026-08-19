import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
} from '@earendil-works/pi-tui';
import { show_modal, type ModalTheme } from '@spences10/pi-tui-modal';
import {
	get_prompt_source_label,
	list_base_presets,
	list_layer_presets,
} from './catalog.js';
import { build_active_prompt_blocks } from './prompt-blocks.js';
import { NONE_BASE_ID } from './state.js';
import type { LoadedPromptPreset } from './types.js';

export interface PromptPresetManagerState {
	presets: Record<string, LoadedPromptPreset>;
	active_base_name: string | undefined;
	active_layers: ReadonlySet<string>;
}

export type PromptPresetManagementAction =
	| 'create'
	| 'edit'
	| 'copy'
	| 'rename'
	| 'delete'
	| 'reset'
	| 'reload';

export type PromptPresetManagerResult =
	| {
			action: 'apply';
			base_name: string | undefined;
			layers: ReadonlySet<string>;
	  }
	| { action: 'cancel' }
	| {
			action: PromptPresetManagementAction;
			preset?: LoadedPromptPreset;
	  };

type PresetRow =
	| { type: 'header'; id: string; label: string }
	| { type: 'base-none'; id: typeof NONE_BASE_ID; label: string }
	| { type: 'preset'; id: string; preset: LoadedPromptPreset };

export async function show_prompt_preset_manager(
	ctx: ExtensionCommandContext,
	state: PromptPresetManagerState,
): Promise<PromptPresetManagerResult> {
	const base_presets = list_base_presets(state.presets);
	const layer_presets = list_layer_presets(state.presets);
	if (base_presets.length === 0 && layer_presets.length === 0) {
		ctx.ui.notify('No prompt presets available', 'warning');
		return { action: 'cancel' };
	}

	const result = await show_modal<
		PromptPresetManagerResult | undefined
	>(
		ctx,
		{
			title: 'Prompt presets',
			subtitle: 'Choose one base preset, then add optional layers.',
			footer: '↑↓ move • space select • enter Apply • esc Cancel',
			overlay_options: {
				width: '94%',
				minWidth: 44,
				maxHeight: '92%',
			},
		},
		({ done }, theme, layout) =>
			new PromptPresetInspectorBody(
				state,
				theme,
				() => layout.get_max_body_lines(),
				done,
			),
	);

	return result ?? { action: 'cancel' };
}

export class PromptPresetInspectorBody implements Component {
	private readonly rows: PresetRow[];
	private selected_index: number;
	private selected_base: string | undefined;
	private readonly enabled_layers: Set<string>;
	private preview_mode: 'item' | 'effective' = 'item';
	private preview_offset = 0;
	private preview_lines: string[] = [];

	constructor(
		private readonly state: PromptPresetManagerState,
		private readonly theme: ModalTheme,
		private readonly get_max_lines: () => number,
		private readonly done: (
			result: PromptPresetManagerResult | undefined,
		) => void,
	) {
		const base_presets = list_base_presets(state.presets);
		const layer_presets = list_layer_presets(state.presets);
		this.rows = [
			{
				type: 'header',
				id: '__base_header__',
				label: `Base presets (${base_presets.length + 1})`,
			},
			{ type: 'base-none', id: NONE_BASE_ID, label: '(none)' },
			...base_presets.map((preset) => ({
				type: 'preset' as const,
				id: preset.name,
				preset,
			})),
			{
				type: 'header',
				id: '__layer_header__',
				label: `Prompt layers (${layer_presets.length})`,
			},
			...layer_presets.map((preset) => ({
				type: 'preset' as const,
				id: preset.name,
				preset,
			})),
		];
		this.selected_base = state.active_base_name;
		this.enabled_layers = new Set(state.active_layers);
		this.selected_index = this.get_initial_selected_index();
	}

	render(width: number): string[] {
		const body_lines = Math.max(8, this.get_max_lines());
		if (width < 80) return this.render_stacked(width, body_lines);

		const list_width = Math.min(
			38,
			Math.max(28, Math.floor(width * 0.38)),
		);
		const preview_width = width - list_width - 3;
		const list = this.render_list(list_width, body_lines);
		const preview = this.render_preview(preview_width, body_lines);
		const lines: string[] = [];
		for (let i = 0; i < body_lines; i++) {
			lines.push(
				`${this.pad_line(list[i] ?? '', list_width)} ${this.theme.fg('dim', '│')} ${preview[i] ?? ''}`,
			);
		}
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate(): void {
		// No cached rendering.
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) || data === 'k') {
			this.move(-1);
		} else if (matchesKey(data, Key.down) || data === 'j') {
			this.move(1);
		} else if (data === ' ' || matchesKey(data, Key.enter)) {
			if (matchesKey(data, Key.enter)) {
				this.done({
					action: 'apply',
					base_name: this.selected_base,
					layers: new Set(this.enabled_layers),
				});
				return;
			}
			this.toggle_selected();
		} else if (data === '\t') {
			this.preview_mode =
				this.preview_mode === 'item' ? 'effective' : 'item';
			this.preview_offset = 0;
		} else if (data === 'c') {
			this.selected_base = undefined;
			this.enabled_layers.clear();
			this.preview_mode = 'effective';
			this.preview_offset = 0;
		} else if (data === 'a') {
			this.done({
				action: 'apply',
				base_name: this.selected_base,
				layers: new Set(this.enabled_layers),
			});
		} else if ('neyrdxl'.includes(data)) {
			const actions = {
				n: 'create',
				e: 'edit',
				y: 'copy',
				r: 'rename',
				d: 'delete',
				x: 'reset',
				l: 'reload',
			} as const;
			const row = this.rows[this.selected_index];
			const action = actions[data as keyof typeof actions];
			if (action === 'create' || action === 'reload') {
				this.done({ action });
			} else if (row?.type === 'preset') {
				this.done({ action, preset: row.preset });
			}
		} else if (matchesKey(data, Key.escape) || data === 'q') {
			this.done({ action: 'cancel' });
		} else if (data === 'J') {
			this.scroll_preview(1);
		} else if (data === 'K') {
			this.scroll_preview(-1);
		}
	}

	private render_stacked(
		width: number,
		body_lines: number,
	): string[] {
		const list_lines = Math.max(5, Math.floor(body_lines / 2));
		return [
			...this.render_list(width, list_lines),
			this.theme.fg('dim', '─'.repeat(Math.min(width, 80))),
			...this.render_preview(width, body_lines - list_lines - 1),
		];
	}

	private render_list(width: number, max_lines: number): string[] {
		const action_lines = wrapTextWithAnsi(
			'N Create  E Edit  Y Copy  R Rename  D Delete  X Reset  L Reload',
			Math.max(20, width),
		).map((line) => this.theme.fg('dim', line));
		const lines = [
			this.theme.fg(
				'accent',
				`Draft: ${this.selected_base ?? '(none)'} + ${this.enabled_layers.size} layer(s)`,
			),
			...action_lines,
			'',
		];
		const visible_rows = Math.max(1, max_lines - lines.length);
		const start = Math.max(
			0,
			Math.min(
				this.selected_index - Math.floor(visible_rows / 2),
				this.rows.length - visible_rows,
			),
		);
		const end = Math.min(start + visible_rows, this.rows.length);
		for (let index = start; index < end; index++) {
			lines.push(this.render_row(this.rows[index], index, width));
		}
		return lines.map((line) => truncateToWidth(line, width));
	}

	private render_preview(width: number, max_lines: number): string[] {
		const heading =
			this.preview_mode === 'effective'
				? 'Full prompt contribution'
				: this.get_selected_heading();
		const text =
			this.preview_mode === 'effective'
				? this.get_effective_prompt_text()
				: this.get_selected_prompt_text();
		const content_width = Math.max(10, width);
		this.preview_lines = text
			.split('\n')
			.flatMap((line) =>
				line.trim().length === 0
					? ['']
					: wrapTextWithAnsi(line, content_width),
			);
		const available = Math.max(1, max_lines - 2);
		const max_offset = Math.max(
			0,
			this.preview_lines.length - available,
		);
		this.preview_offset = Math.max(
			0,
			Math.min(this.preview_offset, max_offset),
		);
		const end = Math.min(
			this.preview_offset + available,
			this.preview_lines.length,
		);
		const range =
			this.preview_lines.length > available
				? ` (${this.preview_offset + 1}-${end}/${this.preview_lines.length})`
				: '';
		return [
			this.theme.fg('accent', this.theme.bold(`${heading}${range}`)),
			'',
			...this.preview_lines
				.slice(this.preview_offset, end)
				.map((line) => truncateToWidth(line, width)),
		];
	}

	private render_row(
		row: PresetRow,
		index: number,
		width: number,
	): string {
		if (row.type === 'header') {
			return this.theme.fg('muted', `  ${row.label}`);
		}
		const selected = index === this.selected_index;
		const cursor = selected ? this.theme.fg('accent', '› ') : '  ';
		const marker = this.get_marker(row);
		const label =
			row.type === 'base-none' ? row.label : row.preset.name;
		const suffix =
			row.type === 'preset'
				? ` ${this.theme.fg('dim', get_prompt_source_label(row.preset.source))}`
				: '';
		return truncateToWidth(
			`${cursor}${marker} ${this.pad(label, 18)}${suffix}`,
			width,
		);
	}

	private get_marker(row: PresetRow): string {
		if (row.type === 'header') return ' ';
		if (row.type === 'base-none') {
			return this.selected_base ? '○' : '●';
		}
		if (row.preset.kind === 'base') {
			return this.selected_base === row.preset.name ? '●' : '○';
		}
		return this.enabled_layers.has(row.preset.name) ? '☑' : '☐';
	}

	private get_selected_prompt_text(): string {
		const row = this.rows[this.selected_index];
		if (!row || row.type === 'header') return '';
		if (row.type === 'base-none') {
			return 'No active base preset. Only enabled prompt layers will be appended.';
		}
		const preset = row.preset;
		return [
			preset.description || undefined,
			preset.description ? '' : undefined,
			preset.instructions.trim() || '(empty preset)',
		]
			.filter((line): line is string => line !== undefined)
			.join('\n');
	}

	private get_effective_prompt_text(): string {
		const blocks = build_active_prompt_blocks(
			this.state.presets,
			this.selected_base,
			this.enabled_layers,
		);
		return blocks.length > 0
			? blocks.join('\n\n')
			: '(No prompt preset text will be appended.)';
	}

	private get_selected_heading(): string {
		const row = this.rows[this.selected_index];
		if (!row || row.type === 'header') return 'Highlighted preset';
		return row.type === 'base-none'
			? 'No base preset'
			: row.preset.name;
	}

	private get_initial_selected_index(): number {
		if (this.selected_base) {
			const base_index = this.rows.findIndex(
				(row) =>
					row.type === 'preset' && row.id === this.selected_base,
			);
			if (base_index >= 0) return base_index;
		}
		const active_layer_index = this.rows.findIndex(
			(row) =>
				row.type === 'preset' && this.enabled_layers.has(row.id),
		);
		return active_layer_index >= 0 ? active_layer_index : 1;
	}

	private toggle_selected(): void {
		const row = this.rows[this.selected_index];
		if (!row || row.type === 'header') return;
		if (row.type === 'base-none') {
			this.selected_base = undefined;
		} else if (row.preset.kind === 'base') {
			this.selected_base = row.preset.name;
		} else if (this.enabled_layers.has(row.preset.name)) {
			this.enabled_layers.delete(row.preset.name);
		} else {
			this.enabled_layers.add(row.preset.name);
		}
		this.preview_mode = 'effective';
		this.preview_offset = 0;
	}

	private move(delta: number): void {
		let next = this.selected_index;
		do {
			next = (next + delta + this.rows.length) % this.rows.length;
		} while (this.rows[next]?.type === 'header');
		this.selected_index = next;
		this.preview_offset = 0;
	}

	private scroll_preview(delta: number): void {
		const max_offset = Math.max(0, this.preview_lines.length - 1);
		this.preview_offset = Math.max(
			0,
			Math.min(this.preview_offset + delta, max_offset),
		);
	}

	private pad(text: string, width: number): string {
		const visible = visibleWidth(text);
		return text + ' '.repeat(Math.max(0, width - visible));
	}

	private pad_line(text: string, width: number): string {
		const truncated = truncateToWidth(text, width);
		return (
			truncated +
			' '.repeat(Math.max(0, width - visibleWidth(truncated)))
		);
	}
}
