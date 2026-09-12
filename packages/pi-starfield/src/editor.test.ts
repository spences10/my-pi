import {
	CustomEditor,
	Theme,
	type KeybindingsManager,
} from '@earendil-works/pi-coding-agent';
import {
	CombinedAutocompleteProvider,
	CURSOR_MARKER,
	stripTerminalSequences,
	visibleWidth,
	type EditorTheme,
	type TUI,
} from '@earendil-works/pi-tui';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	FRAME_MS,
	StarfieldEditor,
	type StarfieldMode,
} from './editor.js';
import { QUOTES } from './quotes.js';
import { star_color, star_frame } from './stars.js';

const identity = (text: string) => text;
const editor_theme: EditorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
const keybindings = {
	matches: () => false,
} as unknown as KeybindingsManager;

function make_theme(
	background = '#202020',
	mode: 'truecolor' | '256color' = 'truecolor',
): Theme {
	return new Theme(
		{
			muted: '#d0d0d0',
			dim: '#888888',
			text: '#eeeeee',
			thinkingXhigh: '#888888',
		} as ConstructorParameters<typeof Theme>[0],
		{
			userMessageBg: background,
			selectedBg: background,
		} as ConstructorParameters<typeof Theme>[1],
		mode,
	);
}

function setup() {
	const request_render = vi.fn();
	const tui = {
		terminal: { rows: 40 },
		requestRender: request_render,
	} as unknown as TUI;
	let mode: StarfieldMode = 'on';
	let active = true;
	let theme = make_theme();
	const editor = new StarfieldEditor(tui, editor_theme, keybindings, {
		theme: () => theme,
		mode: () => mode,
		active: () => active,
	});
	editor.focused = true;
	return {
		editor,
		request_render,
		base: new CustomEditor(tui, editor_theme, keybindings),
		set_mode: (value: StarfieldMode) => {
			mode = value;
		},
		set_active: (value: boolean) => {
			active = value;
		},
		set_theme: (value: Theme) => {
			theme = value;
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const plain = (lines: string[]) => lines.map(stripTerminalSequences);

describe('star frames', () => {
	it('uses stable cells and glyphs, with changing brightness', () => {
		const first = star_frame(120, 0);
		expect(first).toEqual(star_frame(120, 0));
		expect(first.length).toBeGreaterThan(5);
		expect(first.length).toBeLessThan(60);
		expect(first).not.toEqual(star_frame(120, 900));
		expect(first).toEqual(
			star_frame(180, 0).filter((star) => star.x < 120),
		);
		for (const star of first) {
			expect(visibleWidth(star.glyph)).toBe(1);
			expect(star.brightness).toBeGreaterThanOrEqual(0.02);
			expect(star.brightness).toBeLessThanOrEqual(0.28);
		}
	});

	it('blends toward foreground on both light and dark backgrounds', () => {
		expect(
			star_color(
				'\x1b[38;2;200;200;200m',
				'\x1b[48;2;20;20;20m',
				0.5,
			),
		).toBe('\x1b[38;2;110;110;110m');
		expect(
			star_color(
				'\x1b[38;2;20;20;20m',
				'\x1b[48;2;200;200;200m',
				0.5,
			),
		).toBe('\x1b[38;2;110;110;110m');
		expect(star_color('\x1b[39m', '\x1b[49m', 0.5)).toBeUndefined();
	});
});

describe('StarfieldEditor', () => {
	it('renders a shaded three-row field without putting the placeholder in input', () => {
		const { editor } = setup();
		editor.setPaddingX(1);
		const lines = editor.render(100);
		expect(lines).toHaveLength(3);
		expect(lines.every((line) => visibleWidth(line) === 100)).toBe(
			true,
		);
		expect(
			QUOTES.some((quote) =>
				plain(lines)[1]?.slice(1).startsWith(`my-pi · ${quote}`),
			),
		).toBe(true);
		expect(lines.join('').split(CURSOR_MARKER)).toHaveLength(2);
		expect(lines[1]).toContain(` ${CURSOR_MARKER}`);
		expect(editor.getText()).toBe('');
		const submit = vi.fn();
		editor.onSubmit = submit;
		editor.handleInput('\r');
		expect(
			submit.mock.calls.flat().every((value) => value === ''),
		).toBe(true);
	});

	it.each([1, 2, 3, 4, 10, 16, 80, 180])(
		'fits a %i-column terminal and preserves height',
		(width) => {
			const { editor } = setup();
			editor.setPaddingX(3);
			const lines = editor.render(width);
			expect(lines).toHaveLength(3);
			expect(
				lines.every((line) => visibleWidth(line) === width),
			).toBe(true);
		},
	);

	it('delegates text, paste, and history to Pi', () => {
		const { editor, base } = setup();
		base.focused = true;
		for (const input of [
			'hello',
			'\x1b[200~line one\nemoji 😀 and 日本語\x1b[201~',
		]) {
			editor.handleInput(input);
			base.handleInput(input);
			expect(editor.getText()).toBe(base.getText());
			expect(plain(editor.render(30)).slice(1, -1)).toEqual(
				plain(base.render(30)).slice(1, -1),
			);
		}
		editor.setText('');
		editor.addToHistory('earlier prompt');
		editor.handleInput('\x1b[A');
		expect(editor.getText()).toBe('earlier prompt');
		editor.setText('');
		expect(plain(editor.render(80))[1]).toContain('my-pi · ');
	});

	it('keeps a quote stable while empty and cycles the full set after typing', () => {
		const { editor, set_mode } = setup();
		set_mode('static');
		const seen = new Set<string>();
		for (let index = 0; index < QUOTES.length; index++) {
			const line = plain(editor.render(100))[1]!;
			seen.add(line);
			vi.advanceTimersByTime(2000);
			expect(plain(editor.render(100))[1]).toBe(line);
			editor.setText('draft');
			editor.render(100);
			editor.setText('');
		}
		expect(seen.size).toBe(QUOTES.length);
	});

	it('keeps the background through typing, cursor resets, and multiline input', () => {
		const { editor } = setup();
		const background = '\x1b[48;2;32;32;32m';
		for (const text of ['hello', 'first line\nsecond line']) {
			editor.setText(text);
			const lines = editor.render(60);
			expect(lines.every((line) => line.startsWith(background))).toBe(
				true,
			);
			expect(lines.join('')).toContain(`\x1b[0m${background}`);
			expect(plain(lines)[0]).not.toContain('─');
			expect(plain(lines).at(-1)).not.toContain('─');
			expect(lines.slice(1, -1).join('')).not.toMatch(
				/[\u2800-\u28ff]/,
			);
			expect(vi.getTimerCount()).toBe(1);
		}
		editor.setText(
			Array.from({ length: 30 }, (_, index) => `line ${index}`).join(
				'\n',
			),
		);
		expect(plain(editor.render(60))[0]).toContain('more');
	});

	it('keeps slash autocomplete intact', async () => {
		const { editor } = setup();
		editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				[{ name: 'starfield', description: 'Stars' }],
				process.cwd(),
			),
		);
		editor.handleInput('/sta');
		await vi.advanceTimersByTimeAsync(300);
		expect(editor.isShowingAutocomplete()).toBe(true);
		expect(plain(editor.render(80)).join('\n')).toContain(
			'starfield',
		);
		expect(plain(editor.render(80)).join('\n')).not.toContain(
			'my-pi · ',
		);
	});

	it('keeps the same stars and animation phase when typing and clearing text', () => {
		const { editor } = setup();
		editor.render(100);
		vi.advanceTimersByTime(1500);
		const before = editor.render(100);
		editor.handleInput('some text');
		const typed = editor.render(100);
		expect(typed[0]).toBe(before[0]);
		expect(typed[2]).toBe(before[2]);
		expect(typed[0] + typed[2]).toMatch(/[\u2800-\u28ff]/);
		expect(typed[1]).not.toMatch(/[\u2800-\u28ff]/);
		editor.setText('');
		const cleared = editor.render(100);
		expect(cleared[0]).toBe(before[0]);
		expect(cleared[2]).toBe(before[2]);
	});

	it('uses one timer while typing and stops on focus loss, replacement, and disposal', () => {
		const { editor, request_render, set_active } = setup();
		editor.render(80);
		editor.render(80);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(FRAME_MS);
		expect(request_render).toHaveBeenCalledTimes(1);
		editor.render(80);
		editor.setText('typed');
		vi.advanceTimersByTime(FRAME_MS);
		expect(request_render).toHaveBeenCalledTimes(2);
		editor.setText('');
		editor.render(80);
		editor.focused = false;
		vi.advanceTimersByTime(FRAME_MS);
		expect(request_render).toHaveBeenCalledTimes(2);
		editor.focused = true;
		editor.render(80);
		set_active(false);
		vi.advanceTimersByTime(FRAME_MS);
		expect(request_render).toHaveBeenCalledTimes(2);
		set_active(true);
		editor.render(80);
		editor.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('supports static/off modes and live theme changes', () => {
		const { editor, set_mode, set_theme } = setup();
		set_mode('static');
		const lines = editor.render(80);
		vi.advanceTimersByTime(3000);
		expect(editor.render(80)).toEqual(lines);
		expect(vi.getTimerCount()).toBe(0);
		set_theme(make_theme('#eeeeee'));
		expect(editor.render(80)[0]).toContain('\x1b[48;2;238;238;238m');
		set_theme(make_theme('#eeeeee', '256color'));
		expect(editor.render(80)[0]).not.toContain('\x1b[38;2;');
		set_mode('off');
		expect(plain(editor.render(80))[1]).not.toContain('my-pi · ');
		expect(vi.getTimerCount()).toBe(0);
	});
});
