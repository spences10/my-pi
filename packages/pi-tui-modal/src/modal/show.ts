import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	Box,
	Key,
	matchesKey,
	SelectList,
	SettingsList,
	Text,
	type SelectItem,
	type TUI,
} from '@earendil-works/pi-tui';
import {
	DetailedSettingsList,
	InputModalBody,
	TextModalBody,
} from './bodies.js';
import { render_framed_modal } from './frame.js';
import {
	cycle_setting_value,
	default_overlay_options,
	fit_visible_items,
	get_modal_body_line_budget,
	get_selected_setting,
	has_active_settings_search,
	is_focusable,
	make_select_theme,
	make_settings_theme,
	normalize_metadata,
	normalize_text,
	set_component_max_visible,
} from './layout.js';
import type {
	ConfirmModalOptions,
	InputModalOptions,
	ModalBody,
	ModalControls,
	ModalLayout,
	ModalOptions,
	ModalTheme,
	PickerModalOptions,
	SettingsModalOptions,
	TextModalOptions,
} from './types.js';

type ModalCommandContext = {
	ui: Pick<ExtensionCommandContext['ui'], 'custom' | 'notify'>;
};

export async function show_modal<T>(
	ctx: ModalCommandContext,
	options: ModalOptions,
	create_body: (
		controls: ModalControls<T>,
		theme: ModalTheme,
		layout: ModalLayout,
		tui: TUI,
	) => ModalBody,
): Promise<T> {
	return await ctx.ui.custom<T>(
		(tui, theme, _kb, done) => {
			const layout: ModalLayout = {
				get_max_body_lines: (body_width?: number) =>
					get_modal_body_line_budget(tui, options, body_width),
			};
			const body = create_body({ done }, theme, layout, tui);

			return {
				get focused(): boolean {
					return is_focusable(body) ? body.focused : false;
				},
				set focused(value: boolean) {
					if (is_focusable(body)) body.focused = value;
				},
				render: (width: number) => {
					const content = new Box(2, 1);

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
					content.addChild({
						render: (body_width: number) =>
							body
								.render(body_width)
								.slice(0, layout.get_max_body_lines(body_width)),
						invalidate: () => body.invalidate(),
					});
					for (const line of normalize_text(options.footer)) {
						content.addChild(new Text(theme.fg('dim', line), 0, 0));
					}

					return render_framed_modal(
						content,
						width,
						options.style,
						theme,
					);
				},
				invalidate: () => {
					body.invalidate();
				},
				dispose: () => body.dispose?.(),
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
	ctx: ModalCommandContext,
	options: PickerModalOptions,
): Promise<string | undefined> {
	if (options.items.length === 0) {
		if (options.empty_message) ctx.ui.notify(options.empty_message);
		return undefined;
	}

	let selected_item: SelectItem | undefined =
		options.items[options.initial_index ?? 0];
	const default_footer = '↑↓ navigate • enter select • esc cancel';
	return await show_modal<string | undefined>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer: options.selected_footer
				? () => {
						const selected_footer =
							options.selected_footer?.(selected_item);
						if (selected_footer !== undefined) return selected_footer;
						if (typeof options.footer === 'function') {
							return options.footer();
						}
						return options.footer ?? default_footer;
					}
				: (options.footer ?? default_footer),
			overlay_options: options.overlay_options,
			style: options.style,
		},
		({ done }, theme, layout) => {
			const preferred_max_visible =
				options.max_visible ?? Math.min(options.items.length, 12);
			const select_list = new SelectList(
				options.items,
				fit_visible_items(
					options.items.length,
					preferred_max_visible,
					layout.get_max_body_lines(),
				),
				make_select_theme(theme),
				options.layout,
			);
			if (options.initial_index !== undefined) {
				select_list.setSelectedIndex(options.initial_index);
			}
			select_list.onSelectionChange = (item) => {
				selected_item = item;
			};
			select_list.onSelect = (item) => done(item.value);
			select_list.onCancel = () => done(undefined);
			return {
				render: (width: number) => {
					set_component_max_visible(
						select_list,
						fit_visible_items(
							options.items.length,
							preferred_max_visible,
							layout.get_max_body_lines(width),
						),
					);
					return select_list.render(width);
				},
				invalidate: () => select_list.invalidate(),
				handleInput: (data: string) => select_list.handleInput(data),
			};
		},
	);
}

export async function show_text_modal(
	ctx: ModalCommandContext,
	options: TextModalOptions,
): Promise<void> {
	await show_modal<void>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer: options.footer ?? '↑↓ scroll • esc back',
			overlay_options: options.overlay_options,
			style: options.style,
		},
		({ done }, theme, layout) => {
			const preferred_max_visible = options.max_visible_lines ?? 18;
			const body = new TextModalBody(
				options.text,
				Math.min(preferred_max_visible, layout.get_max_body_lines()),
				theme,
				() => done(),
			);
			return {
				render: (width: number) => {
					body.set_max_visible_lines(
						Math.min(
							preferred_max_visible,
							layout.get_max_body_lines(width),
						),
					);
					return body.render(width);
				},
				invalidate: () => body.invalidate(),
				handleInput: (data: string) => body.handleInput(data),
			};
		},
	);
}

export async function show_command_output_modal(
	ctx: ModalCommandContext,
	options: TextModalOptions,
): Promise<void> {
	await show_text_modal(ctx, {
		...options,
		max_visible_lines: options.max_visible_lines ?? 20,
		overlay_options: {
			width: '90%',
			minWidth: 72,
			...options.overlay_options,
		},
	});
}

export async function show_input_modal(
	ctx: ModalCommandContext,
	options: InputModalOptions,
): Promise<string | undefined> {
	return await show_modal<string | undefined>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer: options.footer,
			overlay_options: {
				width: '70%',
				minWidth: 50,
				maxHeight: '60%',
				...options.overlay_options,
			},
			style: options.style,
		},
		({ done }, theme) =>
			new InputModalBody(
				options,
				theme,
				(value) => done(value),
				() => done(undefined),
			),
	);
}

export async function show_confirm_modal(
	ctx: ModalCommandContext,
	options: ConfirmModalOptions,
): Promise<boolean> {
	const selected = await show_picker_modal(ctx, {
		title: options.title,
		subtitle: options.message,
		footer: options.footer ?? 'enter selects • esc cancels',
		overlay_options: {
			width: '70%',
			minWidth: 50,
			maxHeight: '60%',
			...options.overlay_options,
		},
		style: options.style,
		items: [
			{
				value: 'confirm',
				label: options.confirm_label ?? 'Confirm',
				description: 'Proceed with this action',
			},
			{
				value: 'cancel',
				label: options.cancel_label ?? 'Cancel',
				description: 'Go back without changing anything',
			},
		],
	});
	return selected === 'confirm';
}

export async function show_settings_modal(
	ctx: ModalCommandContext,
	options: SettingsModalOptions,
): Promise<void> {
	await show_modal<void>(
		ctx,
		{
			title: options.title,
			subtitle: options.subtitle,
			footer:
				options.footer ??
				'↑/↓ navigate • ←/→ change • enter/space next • esc close',
			overlay_options: options.overlay_options,
			style: options.style,
		},
		({ done }, theme, layout) => {
			const preferred_max_visible =
				options.max_visible ??
				Math.min(Math.max(options.items.length + 4, 8), 16);
			const get_max_visible = (width?: number) =>
				fit_visible_items(
					options.items.length,
					preferred_max_visible,
					layout.get_max_body_lines(width) -
						(options.enable_search ? 2 : 0) -
						2 -
						2 -
						(options.metadata ? 3 : 0),
				);
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
						get_max_visible(),
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
						get_max_visible(),
						settings_theme,
						handle_change,
						handle_cancel,
						{ enableSearch: options.enable_search },
					);

			return {
				render: (width: number) => {
					const max_visible = get_max_visible(width);
					if (list instanceof DetailedSettingsList) {
						list.set_max_visible(max_visible);
					} else {
						set_component_max_visible(list, max_visible);
					}
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
				handleInput: (data: string) => {
					if (
						list instanceof SettingsList &&
						!has_active_settings_search(list) &&
						(matchesKey(data, Key.left) ||
							matchesKey(data, Key.right))
					) {
						const item = get_selected_setting(list);
						const new_value = cycle_setting_value(
							item,
							matchesKey(data, Key.left) ? -1 : 1,
						);
						if (item && new_value !== undefined)
							handle_change(item.id, new_value);
						return;
					}
					list.handleInput(data);
				},
			};
		},
	);
}
