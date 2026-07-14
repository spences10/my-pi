import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { SelectList, type SettingItem } from '@earendil-works/pi-tui';
import {
	show_modal,
	show_picker_modal,
	show_settings_modal,
} from '@spences10/pi-tui-modal';
import { save_footer_state } from '../config.js';
import {
	get_current_footer_data,
	install_footer,
} from '../extension/install.js';
import {
	FOOTER_DENSITIES,
	FOOTER_PRESETS,
	FOOTER_STATUS_ALIGNMENTS,
	FOOTER_TONES,
	FOOTER_WIDGETS,
	GIT_ICON_MODES,
	STATUS_LABEL_MODES,
	type FooterDensity,
	type FooterPreset,
	type FooterState,
	type FooterStatusAlignment,
	type FooterStatusPlacement,
	type FooterTone,
	type FooterWidget,
	type GitIconMode,
	type StatusLabelMode,
} from '../presets/types.js';
import { FOOTER_RESEARCH_REFERENCES } from '../reference/research.js';
import { render_footer_lines } from '../render/footer-lines.js';

export function register_footer_command(
	pi: ExtensionAPI,
	state: FooterState,
): void {
	pi.registerCommand('footer', {
		description: 'Configure the Pi footer',
		handler: async (_args, ctx) => {
			await configure_footer(ctx, state);
			save_footer_state(state);
		},
	});
}

async function configure_footer(
	ctx: ExtensionCommandContext,
	state: FooterState,
): Promise<void> {
	while (true) {
		let next_panel: 'widgets' | 'status-layout' | undefined;
		await show_settings_modal(ctx, {
			title: 'Footer settings',
			subtitle:
				'Changes apply live and persist to ~/.pi/agent/my-pi-settings.json.',
			footer:
				'↑/↓ navigate • ←/→ change • enter/space next • esc close',
			items: get_footer_settings(state),
			enable_search: true,
			detail: (item) => get_setting_detail(item.id),
			metadata: (item) => get_setting_metadata(item?.id, ctx, state),
			on_change: (id, new_value) => {
				if (id === 'widgets' || id === 'status-layout') {
					next_panel = id;
					return true;
				}
				apply_footer_setting(state, id, new_value);
				save_footer_state(state);
				install_footer(ctx, state);
				return false;
			},
		});
		if (next_panel === 'widgets') {
			await configure_footer_widgets(ctx, state);
			continue;
		}
		if (next_panel === 'status-layout') {
			await configure_footer_status_layout(ctx, state);
			continue;
		}
		return;
	}
}

function get_footer_settings(state: FooterState): SettingItem[] {
	return [
		{
			id: 'preset',
			label: 'Preset',
			description: 'Overall footer layout',
			currentValue: state.preset,
			values: [...FOOTER_PRESETS],
		},
		{
			id: 'density',
			label: 'Density',
			description: 'How many footer rows to use',
			currentValue: state.density,
			values: [...FOOTER_DENSITIES],
		},
		{
			id: 'tone',
			label: 'Tone',
			description: 'Footer color treatment from the active Pi theme',
			currentValue: state.tone,
			values: [...FOOTER_TONES],
		},
		{
			id: 'status-labels',
			label: 'Status labels',
			description: 'How extension statuses are labelled',
			currentValue: state.status_label_mode,
			values: [...STATUS_LABEL_MODES],
		},
		{
			id: 'git-icons',
			label: 'Git icons',
			description: 'Use Nerd Font git glyphs or plain symbols',
			currentValue: state.git_icon_mode,
			values: [...GIT_ICON_MODES],
		},
		{
			id: 'widgets',
			label: 'Visible content',
			description: 'Choose core footer widgets',
			currentValue: `${get_enabled_widget_count(state)}/${FOOTER_WIDGETS.length} shown`,
			values: ['configure'],
		},
		{
			id: 'status-layout',
			label: 'Extension status layout',
			description: 'Place MCP, harness, usage, and other statuses',
			currentValue: 'configure',
			values: ['configure'],
		},
	];
}

async function configure_footer_widgets(
	ctx: ExtensionCommandContext,
	state: FooterState,
): Promise<void> {
	await show_modal<void>(
		ctx,
		{
			title: 'Footer widgets',
			subtitle: () => get_widget_modal_subtitle(ctx, state),
			footer: 'space toggles • esc back',
		},
		({ done }, theme, layout) => {
			const items = FOOTER_WIDGETS.map((widget) => ({
				value: widget,
				label: widget,
				description: format_widget_state(state, widget),
			}));
			const list = new SelectList(
				items,
				Math.min(items.length, layout.get_max_body_lines()),
				{
					selectedPrefix: (text) => theme.fg('accent', text),
					selectedText: (text) => theme.fg('accent', text),
					description: (text) => theme.fg('muted', text),
					scrollInfo: (text) => theme.fg('dim', text),
					noMatch: (text) => theme.fg('dim', text),
				},
			);
			list.onCancel = () => done();
			return {
				render: (width: number) => list.render(width),
				invalidate: () => list.invalidate(),
				handleInput: (data: string) => {
					if (data === ' ') {
						const selected = list.getSelectedItem();
						if (!selected) return;
						const widget = selected.value as FooterWidget;
						state.widgets[widget] = !state.widgets[widget];
						selected.description = format_widget_state(state, widget);
						save_footer_state(state);
						install_footer(ctx, state);
						return;
					}
					list.handleInput(data);
				},
			};
		},
	);
}

async function configure_footer_status_layout(
	ctx: ExtensionCommandContext,
	state: FooterState,
): Promise<void> {
	while (true) {
		const footer_data = get_current_footer_data();
		const live_statuses = new Map(
			footer_data?.getExtensionStatuses() ?? [],
		);
		const keys = Array.from(
			new Set([
				...Object.keys(state.status_layout),
				...live_statuses.keys(),
				'preset',
			]),
		);
		const selected = await show_picker_modal(ctx, {
			title: 'Extension status layout',
			subtitle:
				'Choose a status, then assign any row and left, center, or right alignment.',
			footer: 'enter configures • search filters • esc back',
			items: keys.map((key) => ({
				value: key,
				label: key,
				description:
					live_statuses.get(key) ??
					(key === 'preset'
						? 'Active prompt preset status'
						: 'Not currently published'),
			})),
			empty_message: 'No extension statuses available',
			selected_footer: (item) => {
				if (!item) return undefined;
				return format_status_placement(
					status_placement_for(state, item.value),
				);
			},
		});
		if (!selected) return;
		await configure_footer_status(ctx, state, selected, keys.length);
		compact_status_rows(state);
		save_footer_state(state);
		install_footer(ctx, state);
	}
}

async function configure_footer_status(
	ctx: ExtensionCommandContext,
	state: FooterState,
	key: string,
	status_count: number,
): Promise<void> {
	const placement = status_placement_for(state, key);
	const row_count = Math.max(status_count, placement.row, 1);
	await show_settings_modal(ctx, {
		title: `Status: ${key}`,
		subtitle:
			'Rows appear only when populated; empty rows are removed automatically.',
		footer: '↑/↓ navigate • ←/→ change • enter/space next • esc back',
		items: [
			{
				id: 'row',
				label: 'Row',
				description: 'Vertical status row',
				currentValue: String(placement.row),
				values: Array.from({ length: row_count }, (_, index) =>
					String(index + 1),
				),
			},
			{
				id: 'alignment',
				label: 'Alignment',
				description: 'Horizontal position within the row',
				currentValue: placement.alignment,
				values: [...FOOTER_STATUS_ALIGNMENTS],
			},
			{
				id: 'visibility',
				label: 'Visibility',
				description: 'Show or hide this status',
				currentValue: placement.hidden ? 'hidden' : 'shown',
				values: ['shown', 'hidden'],
			},
		],
		metadata: () => get_footer_preview(ctx, state),
		on_change: (id, new_value) => {
			if (id === 'row') placement.row = Number(new_value);
			if (
				id === 'alignment' &&
				FOOTER_STATUS_ALIGNMENTS.includes(
					new_value as FooterStatusAlignment,
				)
			) {
				placement.alignment = new_value as FooterStatusAlignment;
			}
			if (id === 'visibility')
				placement.hidden = new_value === 'hidden';
			state.status_layout[key] = placement;
			save_footer_state(state);
			install_footer(ctx, state);
		},
	});
}

function status_placement_for(
	state: FooterState,
	key: string,
): FooterStatusPlacement {
	return (
		state.status_layout[key] ?? {
			row: 1,
			alignment: 'left',
			hidden: false,
		}
	);
}

function compact_status_rows(state: FooterState): void {
	const occupied_rows = Array.from(
		new Set(
			Object.values(state.status_layout)
				.filter((placement) => !placement.hidden)
				.map((placement) => placement.row),
		),
	).sort((a, b) => a - b);
	const row_map = new Map(
		occupied_rows.map((row, index) => [row, index + 1]),
	);
	for (const placement of Object.values(state.status_layout)) {
		if (!placement.hidden)
			placement.row = row_map.get(placement.row) ?? placement.row;
	}
}

function format_status_placement(
	placement: FooterStatusPlacement,
): string {
	return placement.hidden
		? 'hidden'
		: `row ${placement.row} • ${placement.alignment}`;
}

function get_enabled_widget_count(state: FooterState): number {
	return FOOTER_WIDGETS.filter((widget) => state.widgets[widget])
		.length;
}

function get_widget_modal_subtitle(
	ctx: ExtensionCommandContext,
	state: FooterState,
): string[] {
	const footer_data = get_current_footer_data();
	if (!footer_data)
		return ['Choose footer building blocks to show or hide.'];
	const lines = render_footer_lines(
		ctx as ExtensionContext,
		ctx.ui.theme,
		footer_data,
		state,
		72,
	);
	return [
		'Choose footer building blocks to show or hide.',
		'',
		'Preview:',
		...(lines.length > 0
			? lines.map((line) => `  ${line}`)
			: ['  —']),
	];
}

function format_widget_state(
	state: FooterState,
	widget: FooterWidget,
): string {
	return state.widgets[widget] ? '● enabled' : '○ disabled';
}

function apply_footer_setting(
	state: FooterState,
	id: string,
	new_value: string,
): void {
	if (
		id === 'preset' &&
		FOOTER_PRESETS.includes(new_value as FooterPreset)
	) {
		state.preset = new_value as FooterPreset;
	}
	if (
		id === 'density' &&
		FOOTER_DENSITIES.includes(new_value as FooterDensity)
	) {
		state.density = new_value as FooterDensity;
	}
	if (
		id === 'tone' &&
		FOOTER_TONES.includes(new_value as FooterTone)
	) {
		state.tone = new_value as FooterTone;
	}
	if (
		id === 'status-labels' &&
		STATUS_LABEL_MODES.includes(new_value as StatusLabelMode)
	) {
		state.status_label_mode = new_value as StatusLabelMode;
	}
	if (
		id === 'git-icons' &&
		GIT_ICON_MODES.includes(new_value as GitIconMode)
	) {
		state.git_icon_mode = new_value as GitIconMode;
	}
}

function get_setting_detail(id: string): string | undefined {
	if (id === 'preset')
		return 'Presets are starter arrangements; widget toggles decide exact content.';
	if (id === 'density')
		return 'Compact is one row, comfortable is normal 2–3 rows, expanded adds diagnostic/footer mode detail.';
	if (id === 'tone')
		return 'Muted uses dim theme color, balanced uses plain terminal foreground, bright uses theme accent.';
	if (id === 'status-labels')
		return 'Smart avoids doubled labels such as mcp:MCP 6/6 connected.';
	if (id === 'git-icons')
		return 'Nerd uses terminal font glyphs; plain uses ASCII-safe symbols.';
	if (id === 'widgets')
		return 'Open a dedicated picker for core footer building blocks.';
	if (id === 'status-layout')
		return 'Assign each published extension status to any dynamic row with left, center, or right alignment, or hide it.';
}

function get_footer_preview(
	ctx: ExtensionCommandContext,
	state: FooterState,
): string[] {
	const footer_data = get_current_footer_data();
	if (!footer_data)
		return ['Preview unavailable before footer setup.'];
	const lines = render_footer_lines(
		ctx as ExtensionContext,
		ctx.ui.theme,
		footer_data,
		state,
		72,
	);
	return [
		'Preview:',
		...(lines.length > 0
			? lines.map((line) => `  ${line}`)
			: ['  —']),
	];
}

function get_setting_metadata(
	id: string | undefined,
	ctx: ExtensionCommandContext,
	state: FooterState,
): string[] {
	const lines = get_footer_preview(ctx, state);
	if (id === 'widgets') {
		lines.push('', 'Shown widgets:');
		for (const widget of FOOTER_WIDGETS.filter(
			(widget) => state.widgets[widget],
		)) {
			lines.push(`• ${widget}`);
		}
	}
	if (id === 'status-layout') {
		lines.push(
			'',
			'Rows are created from visible status placements.',
			'Empty rows collapse automatically.',
		);
	}
	if (id === 'preset') {
		lines.push('', 'Layout references:');
		for (const reference of FOOTER_RESEARCH_REFERENCES.slice(0, 3)) {
			lines.push(`• ${reference.name}: ${reference.takeaways[0]}`);
		}
	}
	return lines;
}
