import {
	DynamicBorder,
	type ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import {
	Box,
	Container,
	SelectList,
	SettingsList,
	Text,
	type Component,
	type OverlayOptions,
	type SelectItem,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SettingItem,
	type SettingsListTheme,
} from '@mariozechner/pi-tui';

type ModalColor = 'accent' | 'muted' | 'dim' | 'warning' | 'success';

type ModalTheme = {
	fg(color: ModalColor, text: string): string;
	bold(text: string): string;
};

export type ModalText = string | (() => string | string[]);

export interface ModalOptions {
	title: string;
	subtitle?: ModalText;
	footer?: ModalText;
	overlay_options?: OverlayOptions;
}

export interface ModalBody extends Component {
	handleInput?(data: string): void;
}

export interface ModalControls<T> {
	done: (result: T) => void;
}

export interface PickerModalOptions {
	title: string;
	subtitle?: ModalText;
	footer?: ModalText;
	overlay_options?: OverlayOptions;
	items: SelectItem[];
	initial_index?: number;
	max_visible?: number;
	empty_message?: string;
	layout?: SelectListLayoutOptions;
}

export interface SettingsModalOptions {
	title: string;
	subtitle?: ModalText;
	footer?: ModalText;
	overlay_options?: OverlayOptions;
	items: SettingItem[];
	max_visible?: number;
	enable_search?: boolean;
	on_change: (id: string, new_value: string) => boolean | void;
	on_cancel?: () => void;
}

const default_overlay_options: OverlayOptions = {
	width: '80%',
	minWidth: 60,
	maxHeight: '80%',
};

function normalize_text(value: ModalText | undefined): string[] {
	if (!value) return [];
	const resolved = typeof value === 'function' ? value() : value;
	return Array.isArray(resolved) ? resolved : [resolved];
}

function make_select_theme(theme: ModalTheme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg('accent', text),
		selectedText: (text) => theme.fg('accent', text),
		description: (text) => theme.fg('muted', text),
		scrollInfo: (text) => theme.fg('dim', text),
		noMatch: (text) => theme.fg('warning', text),
	};
}

function value_color(value: string): ModalColor {
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

function make_settings_theme(theme: ModalTheme): SettingsListTheme {
	return {
		cursor: theme.fg('accent', '›'),
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

export async function show_modal<T>(
	ctx: ExtensionCommandContext,
	options: ModalOptions,
	create_body: (
		controls: ModalControls<T>,
		theme: ModalTheme,
	) => ModalBody,
): Promise<T> {
	return await ctx.ui.custom<T>(
		(tui, theme, _kb, done) => {
			const body = create_body({ done }, theme);

			return {
				render: (width: number) => {
					const container = new Container();
					const content = new Box(2, 1);

					container.addChild(
						new DynamicBorder((text: string) =>
							theme.fg('accent', text),
						),
					);
					content.addChild(
						new Text(
							theme.fg('accent', theme.bold(options.title)),
							0,
							0,
						),
					);
					for (const line of normalize_text(options.subtitle)) {
						content.addChild(new Text(theme.fg('muted', line), 0, 0));
					}
					content.addChild(body);
					for (const line of normalize_text(options.footer)) {
						content.addChild(new Text(theme.fg('dim', line), 0, 0));
					}
					container.addChild(content);
					container.addChild(
						new DynamicBorder((text: string) =>
							theme.fg('accent', text),
						),
					);
					return container.render(width);
				},
				invalidate: () => {
					body.invalidate();
				},
				handleInput: (data: string) => {
					body.handleInput?.(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				...default_overlay_options,
				...options.overlay_options,
			},
		},
	);
}

export async function show_picker_modal(
	ctx: ExtensionCommandContext,
	options: PickerModalOptions,
): Promise<string | undefined> {
	if (options.items.length === 0) {
		if (options.empty_message) ctx.ui.notify(options.empty_message);
		return undefined;
	}

	return await show_modal<string | undefined>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer:
				options.footer ?? '↑↓ navigate • enter select • esc cancel',
			overlay_options: options.overlay_options,
		},
		({ done }, theme) => {
			const select_list = new SelectList(
				options.items,
				options.max_visible ?? Math.min(options.items.length, 12),
				make_select_theme(theme),
				options.layout,
			);
			if (options.initial_index !== undefined) {
				select_list.setSelectedIndex(options.initial_index);
			}
			select_list.onSelect = (item) => done(item.value);
			select_list.onCancel = () => done(undefined);
			return select_list;
		},
	);
}

export async function show_settings_modal(
	ctx: ExtensionCommandContext,
	options: SettingsModalOptions,
): Promise<void> {
	await show_modal<void>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer:
				options.footer ??
				'search filters • enter toggles • esc close',
			overlay_options: options.overlay_options,
		},
		({ done }, theme) => {
			const list = new SettingsList(
				options.items,
				options.max_visible ??
					Math.min(Math.max(options.items.length + 4, 8), 16),
				make_settings_theme(theme),
				(id, new_value) => {
					if (options.on_change(id, new_value)) done();
				},
				() => {
					options.on_cancel?.();
					done();
				},
				{ enableSearch: options.enable_search },
			);
			return list;
		},
	);
}
