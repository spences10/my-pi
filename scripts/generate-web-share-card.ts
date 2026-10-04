// Renders the link-preview card for the landing page to
// apps/web/static/og.png. Run it again when the logo or tagline changes.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { logo_lines } from '../apps/web/src/lib/config/logo.ts';
import { site_config } from '../apps/web/src/lib/config/site.ts';

const OUTPUT_PATH = 'apps/web/static/og.png';
// The 1.91:1 card that every platform crops to.
const WIDTH = 1200;
const HEIGHT = 630;

// Afterglow theme, as in apps/web/src/routes/layout.css
const BACKGROUND = '#06040f';
const TEXT = '#fff7ff';
const MUTED = '#8a7fb5';
const VIOLET = '#9d4dff';
const MAGENTA = '#ff00cc';
const BLUE = '#00eaff';
const GREEN = '#ccff00';
const GRADIENT = [
	[204, 255, 0],
	[255, 176, 0],
	[255, 0, 204],
	[0, 234, 255],
];
const FONT =
	"'VictorMono Nerd Font', 'Victor Mono', 'DejaVu Sans Mono', monospace";
const TAGLINE = 'a curated Pi coding-agent distribution';
const COMMAND = 'pnpx my-pi@latest';
const DOMAIN = new URL(site_config.url).host;

function gradient_at(position: number, shade = 1) {
	const scaled = Math.min(Math.max(position, 0), 1) * 3;
	const index = Math.min(2, Math.floor(scaled));
	const mix = scaled - index;
	const channels = GRADIENT[index].map((from, channel) =>
		Math.round(
			(from + (GRADIENT[index + 1][channel] - from) * mix) * shade,
		),
	);
	return `rgb(${channels.join(',')})`;
}

const CELL_WIDTH = 23;
const CELL_HEIGHT = 39;
const DEPTH_X = 6;
const DEPTH_Y = 4;
const columns = logo_lines[0].length;
const logo_x = (WIDTH - columns * CELL_WIDTH) / 2;
const logo_y = 104;

const cells = logo_lines.flatMap((line, row) =>
	line.split('').flatMap((char, column) =>
		char === '█'
			? [
					{
						x: logo_x + column * CELL_WIDTH,
						y: logo_y + row * CELL_HEIGHT,
						position: column / (columns - 1),
					},
				]
			: [],
	),
);

// Offset outlines behind the logo, as the shadow of the ASCII logo.
const echoes = [
	[20, 26, 0.45],
	[10, 13, 0.8],
]
	.map(([dx, dy, opacity]) =>
		cells
			.map(
				({ x, y, position }) =>
					`<rect x="${x + dx}" y="${y + dy}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" fill="none" stroke="${position > 0.62 ? BLUE : MAGENTA}" stroke-opacity="${opacity}"/>`,
			)
			.join(''),
	)
	.join('');

const cubes = cells
	.map(({ x, y, position }) => {
		const right = x + CELL_WIDTH;
		const bottom = y + CELL_HEIGHT;
		return [
			`<polygon points="${right},${y} ${right + DEPTH_X},${y + DEPTH_Y} ${right + DEPTH_X},${bottom + DEPTH_Y} ${right},${bottom}" fill="${gradient_at(position, 0.55)}"/>`,
			`<polygon points="${x},${bottom} ${x + DEPTH_X},${bottom + DEPTH_Y} ${right + DEPTH_X},${bottom + DEPTH_Y} ${right},${bottom}" fill="${gradient_at(position, 0.4)}"/>`,
			`<rect x="${x}" y="${y}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" fill="${gradient_at(position)}" stroke="${gradient_at(position, 0.6)}"/>`,
		].join('');
	})
	.join('');

// A floor grid in perspective below the logo.
const horizon = 392;
const floor = [
	...Array.from({ length: 9 }, (_, index) => {
		const y = horizon + 12 * 1.55 ** index;
		return `<line x1="0" y1="${y}" x2="${WIDTH}" y2="${y}"/>`;
	}),
	...Array.from({ length: 31 }, (_, index) => {
		const spread = (index - 15) * 190;
		return `<line x1="${WIDTH / 2 + spread * 0.16}" y1="${horizon}" x2="${WIDTH / 2 + spread}" y2="${HEIGHT}"/>`;
	}),
].join('');

const corners = [
	[40, 40, 1, 1],
	[WIDTH - 40, 40, -1, 1],
	[40, HEIGHT - 40, 1, -1],
	[WIDTH - 40, HEIGHT - 40, -1, -1],
]
	.map(
		([x, y, dx, dy]) =>
			`<polyline points="${x + dx * 24},${y} ${x},${y} ${x},${y + dy * 24}"/>`,
	)
	.join('');

const command_size = 30;
const char_width = command_size * 0.6;
const chip_width = char_width * (COMMAND.length + 2) + 64;
const chip_x = (WIDTH - chip_width) / 2;
const chip_y = 496;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="magenta" cx="18%" cy="10%" r="60%"><stop offset="0" stop-color="${MAGENTA}" stop-opacity="0.2"/><stop offset="1" stop-color="${MAGENTA}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blue" cx="86%" cy="92%" r="55%"><stop offset="0" stop-color="${BLUE}" stop-opacity="0.13"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
    <linearGradient id="floor" x1="0" y1="${horizon}" x2="0" y2="${HEIGHT}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${VIOLET}" stop-opacity="0"/><stop offset="1" stop-color="${VIOLET}" stop-opacity="0.34"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="${BACKGROUND}"/>
  <rect width="100%" height="100%" fill="url(#magenta)"/>
  <rect width="100%" height="100%" fill="url(#blue)"/>
  <g stroke="url(#floor)" stroke-width="1.2">${floor}</g>
  <g stroke-width="1.4">${echoes}</g>
  <g stroke-width="1.2">${cubes}</g>
  <g font-family="${FONT}" text-anchor="middle">
    <text x="${WIDTH / 2}" y="452" font-size="34" font-weight="500" fill="${TEXT}">${TAGLINE}</text>
    <rect x="${chip_x}" y="${chip_y}" width="${chip_width}" height="66" fill="${BACKGROUND}" stroke="${VIOLET}" stroke-width="1.6"/>
    <text x="${WIDTH / 2}" y="${chip_y + 43}" font-size="${command_size}" font-weight="700" xml:space="preserve"><tspan fill="${MAGENTA}">$ </tspan><tspan fill="${GREEN}">${COMMAND}</tspan></text>
    <text x="${WIDTH - 72}" y="${HEIGHT - 58}" font-size="20" font-weight="600" fill="${MUTED}" text-anchor="end">${DOMAIN}</text>
  </g>
  <g fill="none" stroke="#473a72" stroke-width="1.6">${corners}</g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'original' } })
	.render()
	.asPng();

writeFileSync(OUTPUT_PATH, png);
console.log(`Generated ${OUTPUT_PATH}`);
