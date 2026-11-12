import {
	SettingsList,
	wrapTextWithAnsi,
	type Focusable,
	type OverlayOptions,
	type SelectList,
	type SelectListTheme,
	type SettingItem,
	type SettingsListTheme,
} from '@earendil-works/pi-tui';
import * as v from 'valibot';
import type {
	ModalBorderStyle,
	ModalColor,
	ModalMetadata,
	ModalOptions,
	ModalStyle,
	ModalText,
	ModalTheme,
} from './types.js';

export const default_overlay_options: OverlayOptions = {
	width: '80%',
	minWidth: 60,
	maxHeight: '80%',
};

export const default_modal_style: Required<ModalStyle> = {
	border: 'rounded',
	border_color: 'accent',
};

export type BorderCharacters = {
	top_left: string;
	top: string;
	top_right: string;
	left: string;
	right: string;
	bottom_left: string;
	bottom: string;
	bottom_right: string;
};

export const border_characters: Record<
	Exclude<ModalBorderStyle, 'line' | 'none'>,
	BorderCharacters
> = {
	rounded: {
		top_left: '╭',
		top: '─',
		top_right: '╮',
		left: '│',
		right: '│',
		bottom_left: '╰',
		bottom: '─',
		bottom_right: '╯',
	},
	square: {
		top_left: '┌',
		top: '─',
		top_right: '┐',
		left: '│',
		right: '│',
		bottom_left: '└',
		bottom: '─',
		bottom_right: '┘',
	},
};

export function normalize_text(
	value: ModalText | undefined,
): string[] {
	if (!value) return [];
	const resolved = value instanceof Function ? value() : value;

	return Array.isArray(resolved) ? resolved : [resolved];
}

export function parse_size_value(
	value: number | string | undefined,
	total: number,
): number | undefined {
	if (value === undefined) return undefined;

	// Last resort: number | string is a domain union with no other discriminator.
	if (v.is(v.number(), value)) return value;
	const match = value.match(/^(\d+(?:\.\d+)?)%$/);

	return match
		? Math.floor((Number(match[1]) / 100) * total)
		: undefined;
}

export function get_vertical_margin(
	margin: OverlayOptions['margin'],
): number {
	if (!(margin instanceof Object))
		return Math.max(0, margin ?? 0) * 2;

	return (
		Math.max(0, margin.top ?? 0) + Math.max(0, margin.bottom ?? 0)
	);
}

export function get_terminal_rows(tui: {
	terminal?: { rows?: number };
}): number {
	const rows = (tui as { terminal?: { rows?: number } }).terminal
		?.rows;

	return rows ?? process.stdout.rows ?? 24;
}

export function get_border_line_count(
	style: ModalStyle | undefined,
): number {
	return style?.border === 'none' ? 0 : 2;
}

export function count_text_lines(
	value: ModalText | undefined,
	width: number,
): number {
	return normalize_text(value).reduce((count, text) => {
		if (text.trim() === '') return count;

		return (
			count +
			wrapTextWithAnsi(text.replace(/\t/g, '   '), width).length
		);
	}, 0);
}

export function get_modal_body_line_budget(
	tui: { terminal?: { rows?: number } },
	options: ModalOptions,
	body_width = 80,
): number {
	const terminal_rows = get_terminal_rows(tui);

	const overlay_options = {
		...default_overlay_options,
		...options.overlay_options,
	};

	const available_height = Math.max(
		1,
		terminal_rows - get_vertical_margin(overlay_options.margin),
	);

	const max_height = Math.max(
		1,
		Math.min(
			parse_size_value(overlay_options.maxHeight, terminal_rows) ??
				available_height,
			available_height,
		),
	);

	const fixed_lines =
		get_border_line_count(options.style) +
		2 +
		count_text_lines(options.title, body_width) +
		count_text_lines(options.subtitle, body_width) +
		count_text_lines(options.footer, body_width);

	return Math.max(1, max_height - fixed_lines);
}

export function fit_visible_items(
	item_count: number,
	preferred: number,
	body_line_budget: number,
): number {
	const budget = Math.max(1, body_line_budget);
	const candidate = Math.max(1, Math.min(preferred, item_count));

	if (item_count > candidate) {
		return Math.max(1, Math.min(candidate, budget - 1));
	}

	return Math.max(1, Math.min(candidate, budget));
}

export function set_component_max_visible(
	component: SelectList | SettingsList,
	max_visible: number,
): void {
	Reflect.set(component, 'maxVisible', max_visible);
}

export function normalize_metadata(
	value: ModalMetadata | undefined,
	item: SettingItem | undefined,
): string[] {
	if (!value) return [];
	const resolved = value instanceof Function ? value(item) : value;

	if (!resolved) return [];

	return Array.isArray(resolved) ? resolved : [resolved];
}

export function make_select_theme(
	theme: ModalTheme,
): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg('accent', text),
		selectedText: (text) => theme.fg('accent', text),
		description: (text) => theme.fg('muted', text),
		scrollInfo: (text) => theme.fg('dim', text),
		noMatch: (text) => theme.fg('warning', text),
	};
}

export function value_color(value: string): ModalColor {
	const normalized = value.trim().toLowerCase();

	if (
		normalized.startsWith('●') ||
		normalized.startsWith('✓') ||
		normalized.includes('enabled') ||
		normalized.includes('selected') ||
		normalized.includes('imported')
	) {
		return 'success';
	}

	if (
		normalized.startsWith('↻') ||
		normalized.includes('sync') ||
		normalized.includes('queued')
	) {
		return 'warning';
	}

	return 'dim';
}

export type SettingsListInternals = {
	items: SettingItem[];
	filteredItems: SettingItem[];
	selectedIndex: number;
	searchEnabled: boolean;
	searchInput?: { getValue(): string };
};

// Validate the SDK's current layout without cloning mutable setting items.
const settings_list_internals_schema =
	v.custom<SettingsListInternals>((value) =>
		v.is(
			v.object({
				items: v.array(
					v.object({
						id: v.string(),
						label: v.string(),
						currentValue: v.string(),
						values: v.optional(v.array(v.string())),
					}),
				),
				filteredItems: v.array(
					v.object({
						id: v.string(),
						label: v.string(),
						currentValue: v.string(),
						values: v.optional(v.array(v.string())),
					}),
				),
				selectedIndex: v.number(),
				searchEnabled: v.boolean(),
				searchInput: v.optional(v.object({ getValue: v.function() })),
			}),
			value,
		),
	);

export function get_selected_setting(
	list: SettingsList,
): SettingItem | undefined {
	const internals = v.parse(settings_list_internals_schema, list);

	const items = internals.searchEnabled
		? internals.filteredItems
		: internals.items;

	return items[internals.selectedIndex];
}

export function has_active_settings_search(
	list: SettingsList,
): boolean {
	const internals = v.parse(settings_list_internals_schema, list);

	return Boolean(internals.searchInput?.getValue());
}

export function cycle_setting_value(
	item: SettingItem | undefined,
	direction: -1 | 1,
): string | undefined {
	if (!item?.values || item.values.length === 0) return undefined;
	const current_index = item.values.indexOf(item.currentValue);
	let start_index = current_index;

	if (current_index === -1) start_index = direction === 1 ? -1 : 0;

	const next_index =
		(start_index + direction + item.values.length) %
		item.values.length;

	const new_value = item.values[next_index];
	item.currentValue = new_value;

	return new_value;
}

export function make_settings_theme(
	theme: ModalTheme,
): SettingsListTheme {
	return {
		cursor: theme.fg('accent', '→ '),
		label: (text, selected) => {
			if (text.startsWith('──') && text.endsWith('──')) {
				return theme.fg('dim', theme.bold(text));
			}

			return selected ? theme.fg('accent', text) : text;
		},
		value: (text, selected) => {
			const rendered = theme.fg(value_color(text), text);

			return selected
				? theme.bold(theme.fg('accent', rendered))
				: rendered;
		},
		description: (text) => theme.fg('muted', text),
		hint: (text) => theme.fg('dim', text),
	};
}

export function is_focusable(value: unknown): value is Focusable {
	return (
		value instanceof Object &&
		!(value instanceof Function) &&
		'focused' in value
	);
}
