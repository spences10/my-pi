import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { FooterTone } from '../presets/types.js';

export type FooterTheme = ExtensionContext['ui']['theme'];

export const FOOTER_COLORS = {
	muted: 'dim',
	path: 'dim',
	stats: 'dim',
	status: 'dim',
	accent: 'accent',
	warning: 'warning',
	error: 'error',
} as const;

export function themed_text(
	theme: FooterTheme,
	tone: FooterTone,
	text: string,
): string {
	if (tone === 'bright') return theme.fg(FOOTER_COLORS.accent, text);

	if (tone === 'balanced') return text;

	return theme.fg(FOOTER_COLORS.muted, text);
}

export function muted(theme: FooterTheme, text: string): string {
	return theme.fg(FOOTER_COLORS.muted, text);
}

export function warning(theme: FooterTheme, text: string): string {
	return theme.fg(FOOTER_COLORS.warning, text);
}

export function error(theme: FooterTheme, text: string): string {
	return theme.fg(FOOTER_COLORS.error, text);
}
