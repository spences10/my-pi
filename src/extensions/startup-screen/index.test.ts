import type {
	ExtensionContext,
	Theme,
} from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { render_startup_header } from './index.js';

function fake_theme(
	color_mode: ReturnType<Theme['getColorMode']>,
	colors: Record<string, string> = {},
): Theme {
	return {
		bold: (text: string) => text,
		fg: (_color: string, text: string) => text,
		getColorMode: () => color_mode,
		getFgAnsi: (color: string) =>
			colors[color] ?? '\x1b[38;2;138;190;183m',
	} as unknown as Theme;
}

const truecolor_theme = fake_theme('truecolor');
const plain_theme = fake_theme('256color');

const ctx = {
	cwd: '/repos/state-of-ai-site',
	model: { id: 'gpt-5.5' },
} as ExtensionContext;

const package_version = JSON.parse(
	readFileSync('package.json', 'utf-8'),
).version as string;

describe('render_startup_header', () => {
	it('renders a Davis-style ANSI truecolor title and centered subtitle', () => {
		const colored = render_startup_header(ctx, truecolor_theme, 72);
		const plain = render_startup_header(ctx, plain_theme, 72).join(
			'\n',
		);

		expect(colored.join('\n')).toContain('\x1b[38;2;');
		expect(plain).toContain(`My-Pi v${package_version}`);
		expect(plain).toContain(
			'███╗   ███╗                  ██████╗ ██╗',
		);
		expect(plain).toContain('╚██╗ ██╔╝ ████╗  ██████╔╝██╗');
		expect(plain).toContain('gpt-5.5 · state-of-ai-site');
		expect(colored.every((line) => visibleWidth(line) <= 72)).toBe(
			true,
		);
	});

	it('uses theme colors for truecolor gradients', () => {
		const themed = fake_theme('truecolor', {
			accent: '\x1b[38;2;1;2;3m',
			borderAccent: '\x1b[38;2;4;5;6m',
			mdHeading: '\x1b[38;2;7;8;9m',
			syntaxFunction: '\x1b[38;2;10;11;12m',
			thinkingHigh: '\x1b[38;2;13;14;15m',
			mdCode: '\x1b[38;2;16;17;18m',
		});

		const lines = render_startup_header(ctx, themed, 72).join('\n');

		expect(lines).toContain('\x1b[38;2;1;2;3m');
		expect(lines).toContain('\x1b[38;2;4;5;6m');
		expect(lines).not.toContain('\x1b[38;2;22;83;189m');
	});

	it('uses a compact fallback for narrow terminals', () => {
		const lines = render_startup_header(ctx, truecolor_theme, 16);

		expect(lines).toHaveLength(2);
		expect(lines.join('\n')).toContain(`My-Pi v${package_version}`);
		expect(lines.every((line) => visibleWidth(line) <= 16)).toBe(
			true,
		);
	});
});
