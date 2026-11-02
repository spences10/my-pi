import {
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from '@earendil-works/pi-tui';
import { logo_lines } from '../packages/my-pi/src/logo.ts';
import {
	load_preview_config,
	type PreviewConfig,
} from './package-preview-config.ts';

type Rgb = [number, number, number];
type Cell = {
	char: string;
	column: number;
	color: string;
	bold: boolean;
};
type PreviewLine = {
	text: string;
	cells: Cell[];
	columns: number;
	align: 'center' | 'left';
};

const palette: Rgb[] = [
	[255, 0, 204],
	[0, 234, 255],
	[204, 255, 0],
];
const font_size = 20;
const line_height = 33;
const pad_x = 18;
const pad_y = 4;
const char_width = 12;
const columns = 96;
const segmenter = new Intl.Segmenter(undefined, {
	granularity: 'grapheme',
});

function gradient_color(position: number): string {
	const wrapped = ((position % 1) + 1) % 1;
	const scaled = wrapped * palette.length;
	const index = Math.floor(scaled);
	const mix = scaled - index;
	const from = palette[index];
	const to = palette[(index + 1) % palette.length];
	return `rgb(${from.map((channel, i) => Math.round(channel + (to[i] - channel) * mix)).join(',')})`;
}

function clip(text: string, width: number): string {
	return stripTerminalSequences(truncateToWidth(text, width, '…'));
}

function cells(
	text: string,
	style: (column: number) => { color: string; bold: boolean },
): Cell[] {
	let column = 0;
	return Array.from(segmenter.segment(text), ({ segment }) => {
		const cell = { char: segment, column, ...style(column) };
		column += visibleWidth(segment);
		return cell;
	});
}

function header_line(
	text: string,
	phase = 0,
	logo = false,
): PreviewLine {
	const clipped = clip(text, columns);
	const padding = Math.max(
		0,
		Math.floor((columns - visibleWidth(clipped)) / 2),
	);
	return {
		text: clipped,
		columns: visibleWidth(clipped),
		align: 'center',
		cells: cells(clipped, (column) => ({
			color: gradient_color(
				(padding + column) /
					Math.max(padding + visibleWidth(clipped) - 1, 1) +
					phase,
			),
			bold: !logo,
		})),
	};
}

function substitute(
	text: string,
	version: string,
	config: PreviewConfig,
): string {
	const values = {
		version,
		model: config.model,
		project: config.project,
	};
	return text.replace(
		/\{(version|model|project)\}/g,
		(_match, key: keyof typeof values) => values[key],
	);
}

function align_footer(left: string, right: string): string {
	const clipped_right = clip(right, columns);
	const gap = left && right ? 1 : 0;
	const clipped_left = clip(
		left,
		Math.max(0, columns - visibleWidth(clipped_right) - gap),
	);
	return (
		clipped_left +
		' '.repeat(
			columns -
				visibleWidth(clipped_left) -
				visibleWidth(clipped_right),
		) +
		clipped_right
	);
}

function preview_lines(
	version: string,
	config: PreviewConfig,
): PreviewLine[] {
	const logo_width = Math.max(
		...logo_lines.map((line) => visibleWidth(line)),
	);
	const lines = [
		header_line(''),
		header_line(`My-Pi v${version}`, 0.12),
		header_line(''),
		header_line(''),
		...logo_lines.map((line, row) =>
			header_line(line.padEnd(logo_width), row * 0.045, true),
		),
		header_line(''),
		header_line(''),
		header_line(
			[config.model, config.project].filter(Boolean).join(' · '),
			0.18,
		),
		header_line(''),
	];
	if (config.footer.enabled && config.footer.rows.length > 0) {
		const footer_lines: { text: string; cursor?: boolean }[] = [];
		const separator = { text: '─'.repeat(columns) };
		if (config.footer.editor) lines.push(header_line(''));
		if (config.footer.separator) footer_lines.push(separator);
		if (config.footer.editor) {
			footer_lines.push({ text: '█'.padEnd(columns), cursor: true });
			if (config.footer.separator) footer_lines.push(separator);
		}
		footer_lines.push(
			...config.footer.rows.map((row) => ({
				text: align_footer(
					substitute(row.left, version, config),
					substitute(row.right, version, config),
				),
			})),
		);
		lines.push(
			...footer_lines.map(({ text, cursor }): PreviewLine => ({
				text,
				columns,
				align: 'left',
				cells: cells(text, () => ({
					color: cursor ? '#fff7ff' : config.footer.color,
					bold: false,
				})),
			})),
		);
	}
	return lines;
}

function escape_xml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function render_preview_svg(
	version: string,
	config: PreviewConfig = load_preview_config(),
): string {
	const lines = preview_lines(version, config);
	const width = Math.ceil(columns * char_width + pad_x * 2);
	const height = Math.ceil(lines.length * line_height + pad_y * 2);
	const rows = lines
		.map((line, row) => {
			const x =
				line.align === 'center'
					? (width - line.columns * char_width) / 2
					: pad_x;
			const content = line.cells
				.map((cell) => {
					if (cell.char === ' ') return '';
					const cell_x = (x + cell.column * char_width).toFixed(1);
					if (cell.char === '█') {
						return `<rect x="${cell_x}" y="${pad_y + row * line_height - 5}" width="${char_width}" height="${line_height}" fill="${cell.color}"/>`;
					}
					return `<text x="${cell_x}" y="${pad_y + row * line_height + font_size}" fill="${cell.color}" font-weight="${cell.bold ? 700 : 500}">${escape_xml(cell.char)}</text>`;
				})
				.join('');
			return `<g aria-label="${escape_xml(line.text)}">${content}</g>`;
		})
		.join('\n');
	const frame = config.border.enabled
		? `<rect data-preview-border="true" x="${config.border.width}" y="${config.border.width}" width="${width - config.border.width * 2}" height="${height - config.border.width * 2}" rx="${config.border.radius}" fill="#07020d" stroke="${config.border.gradient ? 'url(#preview-frame)' : config.border.color}" stroke-width="${config.border.width}"/>`
		: '<rect width="100%" height="100%" fill="#07020d"/>';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>My-Pi v${escape_xml(version)} — package preview</title>
  ${config.border.gradient ? `<defs><linearGradient id="preview-frame" x1="0%" y1="0%" x2="100%" y2="100%">${config.border.gradient.map((color, index, stops) => `<stop offset="${(index / (stops.length - 1)) * 100}%" stop-color="${color}"/>`).join('')}</linearGradient></defs>` : ''}
  ${frame}
  <g font-family="VictorMono Nerd Font, Victor Mono, DejaVu Sans Mono, SFMono-Regular, Consolas, monospace" font-size="${font_size}" xml:space="preserve">
${rows}
  </g>
</svg>`;
}
