export const FOOTER_PRESETS = [
	'minimal',
	'default',
	'power',
	'git-heavy',
] as const;

export type FooterPreset = (typeof FOOTER_PRESETS)[number];

export const FOOTER_DENSITIES = [
	'compact',
	'comfortable',
	'expanded',
] as const;

export type FooterDensity = (typeof FOOTER_DENSITIES)[number];

export const STATUS_LABEL_MODES = [
	'smart',
	'always',
	'never',
] as const;

export type StatusLabelMode = (typeof STATUS_LABEL_MODES)[number];

export const FOOTER_STATUS_ALIGNMENTS = [
	'left',
	'center',
	'right',
] as const;

export type FooterStatusAlignment =
	(typeof FOOTER_STATUS_ALIGNMENTS)[number];

export interface FooterStatusPlacement {
	row: number;
	alignment: FooterStatusAlignment;
	hidden: boolean;
}

export type FooterStatusLayout = Record<
	string,
	FooterStatusPlacement
>;

export const FOOTER_TONES = ['muted', 'balanced', 'bright'] as const;

export type FooterTone = (typeof FOOTER_TONES)[number];

export const GIT_ICON_MODES = ['nerd', 'plain'] as const;

export type GitIconMode = (typeof GIT_ICON_MODES)[number];

export const FOOTER_WIDGETS = [
	'path',
	'git',
	'session',
	'model',
	'thinking',
	'context',
	'cost',
	'tokens',
	'statuses',
	'preset',
] as const;

export type FooterWidget = (typeof FOOTER_WIDGETS)[number];

export type FooterWidgetState = Record<FooterWidget, boolean>;

export interface FooterState {
	preset: FooterPreset;
	density: FooterDensity;
	status_label_mode: StatusLabelMode;
	status_layout: FooterStatusLayout;
	tone: FooterTone;
	git_icon_mode: GitIconMode;
	widgets: FooterWidgetState;
}

export const DEFAULT_FOOTER_WIDGETS: FooterWidgetState = {
	path: true,
	git: true,
	session: true,
	model: true,
	thinking: true,
	context: true,
	cost: true,
	tokens: true,
	statuses: true,
	preset: true,
};

export const DEFAULT_FOOTER_STATUS_LAYOUT: FooterStatusLayout = {
	harness: { row: 1, alignment: 'left', hidden: false },
	preset: { row: 1, alignment: 'right', hidden: false },
	mcp: { row: 2, alignment: 'left', hidden: false },
	team: { row: 2, alignment: 'left', hidden: false },
	lsp: { row: 2, alignment: 'left', hidden: false },
	recall: { row: 2, alignment: 'left', hidden: false },
	nopeek: { row: 2, alignment: 'left', hidden: false },
	'codex-usage': { row: 2, alignment: 'right', hidden: false },
};

export const DEFAULT_FOOTER_STATE: FooterState = {
	preset: 'default',
	density: 'comfortable',
	status_label_mode: 'smart',
	status_layout: DEFAULT_FOOTER_STATUS_LAYOUT,
	tone: 'muted',
	git_icon_mode: 'nerd',
	widgets: DEFAULT_FOOTER_WIDGETS,
};
