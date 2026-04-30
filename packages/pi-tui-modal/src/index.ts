import {
	DynamicBorder,
	type ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import {
	Box,
	Container,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	SelectList,
	SettingsList,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
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
export type ModalMetadata =
	| string
	| string[]
	| ((
			item: SettingItem | undefined,
	  ) => string | string[] | undefined);

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
	detail?: (item: SettingItem) => string | undefined;
	metadata?: ModalMetadata;
	on_change: (id: string, new_value: string) => boolean | void;
	on_cancel?: () => void;
}

export interface TextModalOptions extends ModalOptions {
	text: ModalText;
	max_visible_lines?: number;
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

function normalize_metadata(
	value: ModalMetadata | undefined,
	item: SettingItem | undefined,
): string[] {
	if (!value) return [];
	const resolved = typeof value === 'function' ? value(item) : value;
	if (!resolved) return [];
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

type SettingsListInternals = {
	items: SettingItem[];
	filteredItems: SettingItem[];
	selectedIndex: number;
	searchEnabled: boolean;
};

function get_selected_setting(
	list: SettingsList,
): SettingItem | undefined {
	const internals = list as unknown as SettingsListInternals;
	const items = internals.searchEnabled
		? internals.filteredItems
		: internals.items;
	return items[internals.selectedIndex];
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

class TextModalBody implements ModalBody {
	private offset = 0;
	private wrapped_lines: string[] = [];

	constructor(
		private readonly text: ModalText,
		private readonly max_visible_lines: number,
		private readonly theme: ModalTheme,
		private readonly on_cancel: () => void,
	) {}

	render(width: number): string[] {
		this.wrapped_lines = normalize_text(this.text).flatMap((block) =>
			block
				.split('\n')
				.flatMap((line) =>
					line.length === 0 ? [''] : wrapTextWithAnsi(line, width),
				),
		);
		const max_offset = Math.max(
			0,
			this.wrapped_lines.length - this.max_visible_lines,
		);
		this.offset = Math.max(0, Math.min(this.offset, max_offset));
		const end = Math.min(
			this.offset + this.max_visible_lines,
			this.wrapped_lines.length,
		);
		const visible = this.wrapped_lines
			.slice(this.offset, end)
			.map((line) => truncateToWidth(line, width));
		if (this.wrapped_lines.length > this.max_visible_lines) {
			visible.push(
				this.theme.fg(
					'dim',
					truncateToWidth(
						`(${this.offset + 1}-${end}/${this.wrapped_lines.length})`,
						width,
					),
				),
			);
		}
		return visible;
	}

	invalidate(): void {
		// No cached rendering.
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		const max_offset = Math.max(
			0,
			this.wrapped_lines.length - this.max_visible_lines,
		);
		if (keybindings.matches(data, 'tui.select.up') || data === 'k') {
			this.offset = Math.max(0, this.offset - 1);
		} else if (
			keybindings.matches(data, 'tui.select.down') ||
			data === 'j'
		) {
			this.offset = Math.min(max_offset, this.offset + 1);
		} else if (matchesKey(data, Key.home)) {
			this.offset = 0;
		} else if (matchesKey(data, Key.end)) {
			this.offset = max_offset;
		} else if (
			keybindings.matches(data, 'tui.select.cancel') ||
			data === 'q'
		) {
			this.on_cancel();
		}
	}
}

class DetailedSettingsList implements ModalBody {
	private filtered_items: SettingItem[];
	private selected_index = 0;
	private search_input?: Input;

	constructor(
		private readonly items: SettingItem[],
		private readonly max_visible: number,
		private readonly theme: SettingsListTheme,
		private readonly on_change: (
			id: string,
			new_value: string,
		) => void,
		private readonly on_cancel: () => void,
		private readonly options: {
			enable_search?: boolean;
			detail?: (item: SettingItem) => string | undefined;
		},
	) {
		this.filtered_items = items;
		if (options.enable_search) this.search_input = new Input();
	}

	get_selected_item(): SettingItem | undefined {
		return this.get_display_items()[this.selected_index];
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.search_input) {
			lines.push(...this.search_input.render(width));
			lines.push('');
		}

		const display_items = this.get_display_items();
		if (display_items.length === 0) {
			lines.push(
				truncateToWidth(
					this.theme.hint(
						this.items.length === 0
							? '  No settings available'
							: '  No matching settings',
					),
					width,
				),
			);
			this.add_hint_line(lines, width);
			return lines;
		}

		const start_index = Math.max(
			0,
			Math.min(
				this.selected_index - Math.floor(this.max_visible / 2),
				display_items.length - this.max_visible,
			),
		);
		const end_index = Math.min(
			start_index + this.max_visible,
			display_items.length,
		);
		const max_label_width = Math.min(
			30,
			Math.max(...this.items.map((item) => visibleWidth(item.label))),
		);
		const max_value_width = Math.min(
			14,
			Math.max(
				...this.items.map((item) => visibleWidth(item.currentValue)),
			),
		);

		for (let index = start_index; index < end_index; index++) {
			const item = display_items[index];
			if (!item) continue;
			lines.push(
				this.render_item(
					item,
					index === this.selected_index,
					width,
					max_label_width,
					max_value_width,
				),
			);
		}

		if (start_index > 0 || end_index < display_items.length) {
			lines.push(
				this.theme.hint(
					truncateToWidth(
						`  (${this.selected_index + 1}/${display_items.length})`,
						width - 2,
						'',
					),
				),
			);
		}

		const selected_item = this.get_selected_item();
		if (selected_item?.description) {
			lines.push('');
			for (const line of wrapTextWithAnsi(
				selected_item.description,
				width - 4,
			)) {
				lines.push(this.theme.description(`  ${line}`));
			}
		}

		this.add_hint_line(lines, width);
		return lines;
	}

	invalidate(): void {
		// No cached rendering.
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		const display_items = this.get_display_items();
		if (keybindings.matches(data, 'tui.select.up')) {
			if (display_items.length === 0) return;
			this.selected_index =
				this.selected_index === 0
					? display_items.length - 1
					: this.selected_index - 1;
		} else if (keybindings.matches(data, 'tui.select.down')) {
			if (display_items.length === 0) return;
			this.selected_index =
				this.selected_index === display_items.length - 1
					? 0
					: this.selected_index + 1;
		} else if (
			keybindings.matches(data, 'tui.select.confirm') ||
			data === ' '
		) {
			this.activate_item();
		} else if (keybindings.matches(data, 'tui.select.cancel')) {
			this.on_cancel();
		} else if (this.search_input) {
			const sanitized = data.replace(/ /g, '');
			if (!sanitized) return;
			this.search_input.handleInput(sanitized);
			this.apply_filter(this.search_input.getValue());
		}
	}

	private get_display_items(): SettingItem[] {
		return this.search_input ? this.filtered_items : this.items;
	}

	private render_item(
		item: SettingItem,
		selected: boolean,
		width: number,
		max_label_width: number,
		max_value_width: number,
	): string {
		const prefix = selected ? this.theme.cursor : '  ';
		const label = truncateToWidth(item.label, max_label_width, '…');
		const padded_label =
			label +
			' '.repeat(Math.max(0, max_label_width - visibleWidth(label)));
		const value = truncateToWidth(
			item.currentValue,
			max_value_width,
			'',
		);
		const padded_value =
			value +
			' '.repeat(Math.max(0, max_value_width - visibleWidth(value)));
		const detail = this.options.detail?.(item) ?? '';
		const line = [
			prefix,
			this.theme.label(padded_label, selected),
			'  ',
			this.theme.value(padded_value, selected),
			detail ? `  ${this.theme.description(detail)}` : '',
		].join('');
		return truncateToWidth(line, width);
	}

	private activate_item(): void {
		const item = this.get_selected_item();
		if (!item?.values || item.values.length === 0) return;
		const current_index = item.values.indexOf(item.currentValue);
		const next_index = (current_index + 1) % item.values.length;
		const new_value = item.values[next_index];
		item.currentValue = new_value;
		this.on_change(item.id, new_value);
	}

	private apply_filter(query: string): void {
		this.filtered_items = fuzzyFilter(this.items, query, (item) =>
			[
				item.label,
				item.currentValue,
				item.description,
				this.options.detail?.(item),
			]
				.filter(Boolean)
				.join(' '),
		);
		this.selected_index = 0;
	}

	private add_hint_line(lines: string[], width: number): void {
		lines.push('');
		lines.push(
			truncateToWidth(
				this.theme.hint(
					this.search_input
						? '  Type to search · Enter/Space to change · Esc to cancel'
						: '  Enter/Space to change · Esc to cancel',
				),
				width,
			),
		);
	}
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

export async function show_text_modal(
	ctx: ExtensionCommandContext,
	options: TextModalOptions,
): Promise<void> {
	await show_modal<void>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer: options.footer ?? '↑↓ scroll • esc back',
			overlay_options: options.overlay_options,
		},
		({ done }, theme) =>
			new TextModalBody(
				options.text,
				options.max_visible_lines ?? 18,
				theme,
				() => done(),
			),
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
			const max_visible =
				options.max_visible ??
				Math.min(Math.max(options.items.length + 4, 8), 16);
			const settings_theme = make_settings_theme(theme);
			const handle_change = (id: string, new_value: string) => {
				if (options.on_change(id, new_value)) done();
			};
			const handle_cancel = () => {
				options.on_cancel?.();
				done();
			};
			const list = options.detail
				? new DetailedSettingsList(
						options.items,
						max_visible,
						settings_theme,
						handle_change,
						handle_cancel,
						{
							enable_search: options.enable_search,
							detail: options.detail,
						},
					)
				: new SettingsList(
						options.items,
						max_visible,
						settings_theme,
						handle_change,
						handle_cancel,
						{ enableSearch: options.enable_search },
					);

			return {
				render: (width: number) => {
					const lines = list.render(width);
					const selected_item =
						list instanceof DetailedSettingsList
							? list.get_selected_item()
							: get_selected_setting(list);
					const metadata_lines = normalize_metadata(
						options.metadata,
						selected_item,
					);
					if (metadata_lines.length === 0) return lines;

					return [
						...lines,
						'',
						theme.fg('accent', theme.bold('Details')),
						...metadata_lines.map((line) => theme.fg('muted', line)),
					];
				},
				invalidate: () => list.invalidate(),
				handleInput: (data: string) => list.handleInput(data),
			};
		},
	);
}
