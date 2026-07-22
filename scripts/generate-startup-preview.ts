import { Resvg } from '@resvg/resvg-js';
import type {
	ExtensionContext,
	Theme,
} from '@earendil-works/pi-coding-agent';
import { writeFileSync } from 'node:fs';
import { render_startup_header } from '../src/extensions/startup-screen/index.ts';

const OUTPUT_PATH = 'assets/pi-package-preview.png';
const TERMINAL_WIDTH = 100;
const FONT_SIZE = 24;
const LINE_HEIGHT = 28;
const PAD_X = 16;
const PAD_Y = 36;
const CHAR_WIDTH = 14.4;
const RESET_COLOR = '#f0abfc';
const ESC = '\u001B';
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const ANSI_PREFIX_PATTERN = new RegExp(`^${ESC}\\[[0-9;]*m`);
const ANSI_CAPTURE_PREFIX_PATTERN = new RegExp(
	`^${ESC}\\[([0-9;]*)m`,
);
const MODEL_ID = 'gpt-5.5';

type Cell = {
	char: string;
	color: string;
	bold: boolean;
};

type PreviewLine = {
	text: string;
	align: 'center' | 'left' | 'logo';
};

const theme = {
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	fg: (_color: string, text: string) =>
		`\x1b[38;2;255;0;180m${text}\x1b[0m`,
	getColorMode: () => 'truecolor',
	getFgAnsi: (color: string) =>
		({
			accent: '\x1b[38;2;255;0;180m',
			borderAccent: '\x1b[38;2;153;69;255m',
			mdHeading: '\x1b[38;2;0;255;172m',
			syntaxFunction: '\x1b[38;2;204;255;0m',
			thinkingHigh: '\x1b[38;2;255;189;43m',
			mdCode: '\x1b[38;2;66;160;255m',
		})[color] ?? '\x1b[38;2;255;0;180m',
} as unknown as Theme;

const ctx = {
	cwd: '/home/scott/repos/my-pi',
	model: { id: MODEL_ID },
} as ExtensionContext;

function strip_ansi(text: string): string {
	return text.replace(ANSI_PATTERN, '');
}

function escape_xml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function trim_ansi_padding(line: string, trim_right = true): string {
	const plain = strip_ansi(line);
	const left = plain.match(/^ */)?.[0].length ?? 0;
	const right = trim_right
		? (plain.match(/ *$/)?.[0].length ?? 0)
		: 0;
	const end = plain.length - right;
	let visible = 0;
	let output = '';

	for (let i = 0; i < line.length;) {
		const control = ANSI_PREFIX_PATTERN.exec(line.slice(i));
		if (control) {
			output += control[0];
			i += control[0].length;
			continue;
		}

		const char = line[i++]!;
		if (visible >= left && visible < end) output += char;
		visible += 1;
	}

	return output;
}

function cells_from_ansi(line: string): Cell[] {
	const cells: Cell[] = [];
	let color = RESET_COLOR;
	let bold = false;

	for (let i = 0; i < line.length;) {
		if (line[i] === ESC) {
			const control = ANSI_CAPTURE_PREFIX_PATTERN.exec(line.slice(i));
			if (control) {
				const parts = control[1]!.split(';').map(Number);
				if (parts.includes(0)) {
					color = RESET_COLOR;
					bold = false;
				}
				if (parts.includes(1)) bold = true;
				const color_index = parts.findIndex(
					(value, index) => value === 38 && parts[index + 1] === 2,
				);
				if (color_index !== -1) {
					color = `rgb(${parts[color_index + 2]},${parts[color_index + 3]},${parts[color_index + 4]})`;
				}
				i += control[0].length;
				continue;
			}
		}

		cells.push({ char: line[i++]!, color, bold });
	}

	return cells;
}

function render_preview_line(
	line: PreviewLine,
	row: number,
	width: number,
): string {
	const cells = cells_from_ansi(line.text);
	const plain_width = cells.length * CHAR_WIDTH;
	const x =
		line.align === 'center'
			? (width - plain_width) / 2
			: line.align === 'logo'
				? (width - plain_width) / 2
				: PAD_X;
	const text_y = PAD_Y + row * LINE_HEIGHT + FONT_SIZE;
	const rect_y = PAD_Y + row * LINE_HEIGHT + 1;
	const block_height = LINE_HEIGHT - 3;
	return cells
		.map((cell, index) => {
			if (cell.char === ' ') return '';
			const cell_x = (x + index * CHAR_WIDTH).toFixed(1);
			if (cell.char === '█') {
				return `<rect x="${cell_x}" y="${rect_y}" width="${CHAR_WIDTH}" height="${block_height}" fill="${cell.color}"/>`;
			}
			return `<text x="${cell_x}" y="${text_y}" fill="${cell.color}" font-weight="${cell.bold ? 700 : 500}">${escape_xml(cell.char)}</text>`;
		})
		.join('');
}

const header_lines: PreviewLine[] = render_startup_header(
	ctx,
	theme,
	TERMINAL_WIDTH,
	MODEL_ID,
).map((line, index) => ({
	text: trim_ansi_padding(line, index < 2 || index > 7),
	align: index >= 2 && index <= 7 ? 'logo' : 'center',
}));
const FOOTER_WIDTH = 75;
const footer_lines: PreviewLine[] = [
	'─'.repeat(FOOTER_WIDTH),
	'█'.padEnd(FOOTER_WIDTH),
	'─'.repeat(FOOTER_WIDTH),
	'~/repos/my-pi (⌘ main ✐2 ↟2)',
	'$0.000 (sub) 0.0%/272k'.padEnd(FOOTER_WIDTH - 14) +
		`${MODEL_ID} • low`,
	'MCP 6/6 connected'.padEnd(FOOTER_WIDTH - 17) + 'prompt:terse +1',
].map((line) => ({
	text: `\x1b[38;2;255;0;180m${line}\x1b[0m`,
	align: 'left',
}));
const lines = [...header_lines, ...footer_lines];
const cols = Math.max(
	...lines.map((line) => strip_ansi(line.text).length),
);
const image_width = Math.ceil(cols * CHAR_WIDTH + PAD_X * 2);
const image_height = Math.ceil(
	lines.length * LINE_HEIGHT + PAD_Y * 2,
);
const rows = lines
	.map((line, row) => render_preview_line(line, row, image_width))
	.join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image_width}" height="${image_height}" viewBox="0 0 ${image_width} ${image_height}">
  <rect width="100%" height="100%" fill="#07020d"/>
  <g font-family="DejaVu Sans Mono, SFMono-Regular, Consolas, monospace" font-size="${FONT_SIZE}" xml:space="preserve">
${rows}
  </g>
</svg>`;

const png = new Resvg(svg, {
	fitTo: { mode: 'original' },
})
	.render()
	.asPng();

writeFileSync(OUTPUT_PATH, png);
console.log(`Generated ${OUTPUT_PATH}`);
