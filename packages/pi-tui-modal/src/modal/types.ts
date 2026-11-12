import type {
	Component,
	OverlayOptions,
	SelectItem,
	SelectListLayoutOptions,
	SettingItem,
} from '@earendil-works/pi-tui';

export type ModalColor =
	| 'accent'
	| 'muted'
	| 'dim'
	| 'warning'
	| 'success';

export type ModalBorderStyle = 'rounded' | 'square' | 'line' | 'none';

export interface ModalStyle {
	border?: ModalBorderStyle;
	border_color?: ModalColor;
}

export type ModalTheme = {
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
	style?: ModalStyle;
}

export interface ModalBody extends Component {
	handleInput?(data: string): void;
	dispose?(): void;
}

export interface ModalControls<T> {
	done: (result: T) => void;
}

export interface ModalLayout {
	get_max_body_lines(body_width?: number): number;
}

export interface PickerModalOptions {
	title: string;
	subtitle?: ModalText;
	footer?: ModalText;
	selected_footer?: (
		item: SelectItem | undefined,
	) => string | string[] | undefined;
	overlay_options?: OverlayOptions;
	style?: ModalStyle;
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
	style?: ModalStyle;
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

export interface InputModalOptions extends ModalOptions {
	label?: string;
	initial_value?: string;
	trim?: boolean;
	allow_empty?: boolean;
}

export interface ConfirmModalOptions extends ModalOptions {
	message: ModalText;
	confirm_label?: string;
	cancel_label?: string;
}
