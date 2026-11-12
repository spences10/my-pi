import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
} from '@earendil-works/pi-coding-agent';
import {
	colorToHex,
	mixColors,
	rgbColor,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type Color,
} from '@earendil-works/pi-tui';
import { basename } from 'node:path';
import { logo_lines } from './logo.js';
import { read_package_version } from './package-version.js';

const version = read_package_version();

const segmenter = new Intl.Segmenter(undefined, {
	granularity: 'grapheme',
});

const gradient_tokens: ThemeColor[] = [
	'accent',
	'borderAccent',
	'mdHeading',
	'syntaxFunction',
	'thinkingHigh',
	'mdCode',
];

function theme_palette(theme: Theme): Color[] {
	const colors = new Map(
		gradient_tokens.map((token) => {
			const color = theme.colors[token];

			return [colorToHex(color), color];
		}),
	);

	return colors.size >= 2
		? [...colors.values()]
		: [
				rgbColor(255, 0, 180),
				rgbColor(204, 255, 0),
				rgbColor(66, 160, 255),
			];
}

function center_line(text: string, width: number): string {
	const clipped = stripTerminalSequences(
		truncateToWidth(stripTerminalSequences(text), width, ''),
	);

	return (
		' '.repeat(
			Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)),
		) + clipped
	);
}

export function render_splash(
	theme: Theme,
	width: number,
	info: { version: string; model_id: string; project: string },
): string[] {
	if (width < 1) return [];
	const palette = theme_palette(theme);

	function paint(text: string, phase: number, bold = false): string {
		const centered = center_line(text, width);

		const chars = Array.from(
			segmenter.segment(centered),
			({ segment }) => segment,
		);

		return chars
			.map((char, index) => {
				if (char === ' ') return char;

				const position =
					((index / Math.max(chars.length - 1, 1) + phase) % 1) *
					palette.length;

				const from = Math.floor(position);

				return theme.style(char, {
					fg: mixColors(
						palette[from],
						palette[(from + 1) % palette.length],
						position - from,
						'srgb',
					),
					bold,
				});
			})
			.join('');
	}

	const title = paint(`My-Pi v${info.version}`, 0.12, true);

	const subtitle = paint(
		`${info.model_id} · ${info.project}`,
		0.18,
		true,
	);

	const logo_width = Math.max(...logo_lines.map(visibleWidth));

	if (width < logo_width) return [title, subtitle];

	return [
		'',
		title,
		'',
		...logo_lines.map((line, row) =>
			paint(line.padEnd(logo_width), row * 0.045),
		),
		'',
		subtitle,
		'',
	];
}

export default function startup_screen(pi: ExtensionAPI): void {
	let current_model = 'no model selected';
	let request_render: (() => void) | undefined;
	let installed = false;

	pi.on('session_start', (_event, ctx) => {
		if (ctx.mode !== 'tui') return;
		current_model = ctx.model?.id ?? 'no model selected';
		installed = true;
		ctx.ui.setHeader((tui, theme) => {
			request_render = () => tui.requestRender();

			return {
				render: (width) =>
					render_splash(theme, width, {
						version,
						model_id: current_model,
						project: basename(ctx.cwd) || ctx.cwd,
					}),
				invalidate() {},
			};
		});
	});

	pi.on('model_select', (event) => {
		current_model = event.model.id;
		request_render?.();
	});

	function restore_header(ctx: ExtensionContext): void {
		if (ctx.mode === 'tui' && installed) ctx.ui.setHeader(undefined);
		installed = false;
		request_render = undefined;
	}

	pi.on('session_shutdown', (_event, ctx) => restore_header(ctx));
	pi.registerCommand('builtin-header', {
		description: 'Restore the upstream Pi header for this session',
		handler: async (_args, ctx) => {
			restore_header(ctx);
		},
	});
}
