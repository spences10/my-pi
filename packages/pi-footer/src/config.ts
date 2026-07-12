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
	STATUS_LABEL_MODES,
	type FooterState,
	type FooterStatusPlacement,
} from './presets/types.js';

export function load_footer_state(): FooterState {
	try {
		const parsed = read_package_settings<Partial<FooterState>>(
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

export function normalize_footer_state(
	state: Partial<FooterState>,
): FooterState {
	return {
		preset: FOOTER_PRESETS.includes(state.preset as never)
			? state.preset!
			: DEFAULT_FOOTER_STATE.preset,
		density: FOOTER_DENSITIES.includes(state.density as never)
			? state.density!
			: DEFAULT_FOOTER_STATE.density,
		status_label_mode: STATUS_LABEL_MODES.includes(
			state.status_label_mode as never,
		)
			? state.status_label_mode!
			: DEFAULT_FOOTER_STATE.status_label_mode,
		status_layout: normalize_status_layout(state.status_layout),
		tone: FOOTER_TONES.includes(state.tone as never)
			? state.tone!
			: DEFAULT_FOOTER_STATE.tone,
		git_icon_mode: GIT_ICON_MODES.includes(
			state.git_icon_mode as never,
		)
			? state.git_icon_mode!
			: DEFAULT_FOOTER_STATE.git_icon_mode,
		widgets: {
			...DEFAULT_FOOTER_WIDGETS,
			...Object.fromEntries(
				Object.entries(state.widgets ?? {}).filter(([key]) =>
					FOOTER_WIDGETS.includes(key as never),
				),
			),
		},
	};
}

function normalize_status_layout(
	layout: unknown,
): FooterState['status_layout'] {
	const normalized = Object.fromEntries(
		Object.entries(DEFAULT_FOOTER_STATUS_LAYOUT).map(
			([key, placement]) => [key, { ...placement }],
		),
	);
	if (!layout || typeof layout !== 'object') return normalized;
	for (const [key, value] of Object.entries(layout)) {
		const placement = normalize_status_placement(value);
		if (key.length > 0 && placement) normalized[key] = placement;
	}
	return normalized;
}

function normalize_status_placement(
	value: unknown,
): FooterStatusPlacement | undefined {
	if (typeof value === 'string') {
		const legacy: Record<string, FooterStatusPlacement> = {
			'primary-left': { row: 1, alignment: 'left', hidden: false },
			'primary-right': { row: 1, alignment: 'right', hidden: false },
			'secondary-left': { row: 2, alignment: 'left', hidden: false },
			'secondary-right': {
				row: 2,
				alignment: 'right',
				hidden: false,
			},
			hidden: { row: 1, alignment: 'left', hidden: true },
		};
		return legacy[value];
	}
	if (!value || typeof value !== 'object') return undefined;
	const candidate = value as Partial<FooterStatusPlacement>;
	if (
		!Number.isInteger(candidate.row) ||
		(candidate.row ?? 0) < 1 ||
		(candidate.row ?? 0) > 99 ||
		!FOOTER_STATUS_ALIGNMENTS.includes(candidate.alignment as never)
	)
		return undefined;
	return {
		row: candidate.row!,
		alignment: candidate.alignment!,
		hidden: candidate.hidden === true,
	};
}

function clone_default_state(): FooterState {
	return normalize_footer_state(DEFAULT_FOOTER_STATE);
}
