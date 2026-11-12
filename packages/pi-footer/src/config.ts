import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import {
	DEFAULT_FOOTER_STATE,
	DEFAULT_FOOTER_STATUS_LAYOUT,
	DEFAULT_FOOTER_WIDGETS,
	FOOTER_DENSITIES,
	FOOTER_PRESETS,
	FOOTER_STATUS_ALIGNMENTS,
	FOOTER_TONES,
	FOOTER_WIDGETS,
	GIT_ICON_MODES,
	find_option,
	STATUS_LABEL_MODES,
	type FooterState,
	type FooterStatusPlacement,
} from './presets/types.js';

export function load_footer_state(): FooterState {
	try {
		const parsed = read_package_settings<StoredFooterState>(
			'footer',
			{},
		);

		return normalize_footer_state(parsed);
	} catch {
		return clone_default_state();
	}
}

export function save_footer_state(state: FooterState): void {
	write_package_settings('footer', state);
}

/** Persisted placements may predate the object shape and be a legacy string. */
type StoredStatusPlacement =
	| string
	| { row?: number; alignment?: string; hidden?: boolean };

/** Persisted footer state may be partial and hold legacy placement values. */
export type StoredFooterState = Partial<
	Omit<FooterState, 'status_layout'>
> & {
	status_layout?: Record<string, StoredStatusPlacement>;
};

export function normalize_footer_state(
	state: StoredFooterState,
): FooterState {
	return {
		preset:
			find_option(FOOTER_PRESETS, state.preset) ??
			DEFAULT_FOOTER_STATE.preset,
		density:
			find_option(FOOTER_DENSITIES, state.density) ??
			DEFAULT_FOOTER_STATE.density,
		status_label_mode:
			find_option(STATUS_LABEL_MODES, state.status_label_mode) ??
			DEFAULT_FOOTER_STATE.status_label_mode,
		status_layout: normalize_status_layout(state.status_layout),
		tone:
			find_option(FOOTER_TONES, state.tone) ??
			DEFAULT_FOOTER_STATE.tone,
		git_icon_mode:
			find_option(GIT_ICON_MODES, state.git_icon_mode) ??
			DEFAULT_FOOTER_STATE.git_icon_mode,
		widgets: {
			...DEFAULT_FOOTER_WIDGETS,
			...Object.fromEntries(
				Object.entries(state.widgets ?? {}).filter(([key]) =>
					FOOTER_WIDGETS.some((widget) => widget === key),
				),
			),
		},
	};
}

function normalize_status_layout(
	layout: Record<string, StoredStatusPlacement> | undefined,
): FooterState['status_layout'] {
	const normalized: FooterState['status_layout'] = Object.fromEntries(
		Object.entries(DEFAULT_FOOTER_STATUS_LAYOUT).map(
			([key, placement]) => [key, { ...placement }],
		),
	);

	if (!layout) return normalized;

	for (const [key, value] of Object.entries(layout)) {
		const placement = normalize_status_placement(value);

		if (key.length > 0 && placement) normalized[key] = placement;
	}

	return normalized;
}

const LEGACY_STATUS_PLACEMENTS = new Map<
	string,
	FooterStatusPlacement
>([
	['primary-left', { row: 1, alignment: 'left', hidden: false }],
	['primary-right', { row: 1, alignment: 'right', hidden: false }],
	['secondary-left', { row: 2, alignment: 'left', hidden: false }],
	['secondary-right', { row: 2, alignment: 'right', hidden: false }],
	['hidden', { row: 1, alignment: 'left', hidden: true }],
]);

function normalize_status_placement(
	value: StoredStatusPlacement,
): FooterStatusPlacement | undefined {
	if (!(value instanceof Object))
		return LEGACY_STATUS_PLACEMENTS.get(value);

	const row = value.row;

	const alignment = find_option(
		FOOTER_STATUS_ALIGNMENTS,
		value.alignment,
	);

	if (
		row === undefined ||
		!Number.isInteger(row) ||
		row < 1 ||
		row > 99 ||
		alignment === undefined
	)
		return undefined;

	return {
		row,
		alignment,
		hidden: value.hidden === true,
	};
}

function clone_default_state(): FooterState {
	return normalize_footer_state(DEFAULT_FOOTER_STATE);
}
