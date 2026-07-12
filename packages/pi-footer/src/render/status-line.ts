import {
	truncateToWidth,
	visibleWidth,
} from '@earendil-works/pi-tui';
import type { FooterTone } from '../presets/types.js';
import {
	muted,
	themed_text,
	type FooterTheme,
} from '../theme/tokens.js';
import { sanitize_status_text } from '../utils/text.js';

export function render_footer_three_column_line(
	theme: FooterTheme,
	width: number,
	left_items: string[],
	center_items: string[],
	right_items: string[],
	tone: FooterTone = 'muted',
): string | undefined {
	const center = sanitize_status_text(center_items.join(' • '));
	if (!center) {
		return render_footer_status_line(
			theme,
			width,
			left_items,
			right_items.length > 0 ? right_items.join(' • ') : undefined,
			tone,
		);
	}
	const left = sanitize_status_text(left_items.join(' • '));
	const right = sanitize_status_text(right_items.join(' • '));
	const center_room = Math.max(
		0,
		width - (left ? 1 : 0) - (right ? 1 : 0),
	);
	const rendered_center = truncateToWidth(center, center_room, '...');
	const center_width = visibleWidth(rendered_center);
	const center_start = Math.max(
		0,
		Math.floor((width - center_width) / 2),
	);
	const left_room = Math.max(0, center_start - (left ? 1 : 0));
	const rendered_left = truncateToWidth(left, left_room, '...');
	const right_start = center_start + center_width + (right ? 1 : 0);
	const right_room = Math.max(0, width - right_start);
	const rendered_right = truncateToWidth(right, right_room, '...');

	let line = themed_text(theme, tone, rendered_left);
	line += ' '.repeat(Math.max(0, center_start - visibleWidth(line)));
	line += themed_text(theme, tone, rendered_center);
	if (rendered_right) {
		line += ' '.repeat(
			Math.max(
				1,
				width - visibleWidth(line) - visibleWidth(rendered_right),
			),
		);
		line += themed_text(theme, tone, rendered_right);
	}
	return truncateToWidth(line, width, muted(theme, '...'));
}

export function render_footer_status_line(
	theme: FooterTheme,
	width: number,
	left_items: string[],
	right_item?: string,
	tone: FooterTone = 'muted',
): string | undefined {
	const left = sanitize_status_text(left_items.join(' '));
	const right = right_item ? sanitize_status_text(right_item) : '';
	if (!left && !right) return undefined;
	if (!right) {
		return truncateToWidth(
			themed_text(theme, tone, left),
			width,
			muted(theme, '...'),
		);
	}
	if (!left) {
		const themed_right = themed_text(theme, tone, right);
		const right_width = visibleWidth(themed_right);
		return right_width >= width
			? truncateToWidth(themed_right, width, muted(theme, '...'))
			: `${' '.repeat(width - right_width)}${themed_right}`;
	}

	const right_width = visibleWidth(right);
	if (right_width >= width) {
		return truncateToWidth(
			themed_text(theme, tone, right),
			width,
			muted(theme, '...'),
		);
	}

	const min_gap = 1;
	const available_left = Math.max(0, width - right_width - min_gap);
	const truncated_left = truncateToWidth(left, available_left, '...');
	const left_width = visibleWidth(truncated_left);
	const gap = Math.max(min_gap, width - left_width - right_width);
	return (
		themed_text(theme, tone, truncated_left) +
		' '.repeat(gap) +
		themed_text(theme, tone, right)
	);
}
