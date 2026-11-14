import {
	truncateToWidth,
	visibleWidth,
} from '@earendil-works/pi-tui';

/** Keep the active tab visible when the full strip does not fit. */
export function render_tabs(
	labels: string[],
	active: number,
	width: number,
): string {
	const strip = labels
		.map((label, index) => (index === active ? `[${label}]` : label))
		.join(' · ');

	if (visibleWidth(strip) <= width) return strip;

	return truncateToWidth(
		`‹ ${active + 1}/${labels.length} [${labels[active]}] ›`,
		width,
	);
}
