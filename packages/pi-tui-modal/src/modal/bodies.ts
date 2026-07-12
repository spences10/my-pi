import {
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Focusable,
	type SettingItem,
	type SettingsListTheme,
} from '@earendil-works/pi-tui';
import { cycle_setting_value, normalize_text } from './layout.js';
import type {
	InputModalOptions,
	ModalBody,
	ModalText,
	ModalTheme,
} from './types.js';

function expand_tabs(text: string): string {
	return text.replace(/\t/g, '   ');
}

export class TextModalBody implements ModalBody {
	private offset = 0;
	private wrapped_lines: string[] = [];

	constructor(
		private readonly text: ModalText,
		private max_visible_lines: number,
		private readonly theme: ModalTheme,
		private readonly on_cancel: () => void,
	) {}

	set_max_visible_lines(max_visible_lines: number): void {
		this.max_visible_lines = Math.max(1, max_visible_lines);
	}

	render(width: number): string[] {
		this.wrapped_lines = normalize_text(this.text).flatMap((block) =>
			expand_tabs(block)
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

export class InputModalBody implements ModalBody, Focusable {
	private readonly input = new Input();
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		private readonly options: InputModalOptions,
		private readonly theme: ModalTheme,
		private readonly on_submit: (value: string) => void,
		private readonly on_cancel: () => void,
	) {
		this.input.setValue(options.initial_value ?? '');
		this.input.onSubmit = (value) => {
			const next_value =
				options.trim === false ? value : value.trim();
			if (!options.allow_empty && next_value.length === 0) return;
			this.on_submit(next_value);
		};
		this.input.onEscape = this.on_cancel;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.options.label) {
			for (const line of wrapTextWithAnsi(
				this.options.label,
				width,
			)) {
				lines.push(this.theme.fg('muted', line));
			}
			lines.push('');
		}
		lines.push(...this.input.render(width));
		lines.push('');
		lines.push(
			this.theme.fg(
				'dim',
				this.options.allow_empty
					? 'Enter submits • Esc cancels'
					: 'Enter submits non-empty value • Esc cancels',
			),
		);
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate(): void {
		this.input.invalidate();
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

export class DetailedSettingsList implements ModalBody {
	private filtered_items: SettingItem[];
	private selected_index = 0;
	private search_input?: Input;

	constructor(
		private readonly items: SettingItem[],
		private max_visible: number,
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

	set_max_visible(max_visible: number): void {
		this.max_visible = Math.max(1, max_visible);
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
			!this.search_input?.getValue() &&
			matchesKey(data, Key.left)
		) {
			this.cycle_selected_item(-1);
		} else if (
			!this.search_input?.getValue() &&
			matchesKey(data, Key.right)
		) {
			this.cycle_selected_item(1);
		} else if (
			keybindings.matches(data, 'tui.select.confirm') ||
			data === ' '
		) {
			this.cycle_selected_item(1);
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

	private cycle_selected_item(direction: -1 | 1): void {
		const item = this.get_selected_item();
		const new_value = cycle_setting_value(item, direction);
		if (item && new_value !== undefined)
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
						? '  Type to search · ←/→ change · Enter/Space next · Esc cancel'
						: '  ←/→ change · Enter/Space next · Esc cancel',
				),
				width,
			),
		);
	}
}
