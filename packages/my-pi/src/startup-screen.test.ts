import {
	Theme,
	type ExtensionAPI,
	type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
	stripTerminalSequences,
	visibleWidth,
} from '@earendil-works/pi-tui';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import { logo_lines } from './logo.js';
import startup_screen, { render_splash } from './startup-screen.js';

type HeaderFactory = NonNullable<
	Parameters<ExtensionContext['ui']['setHeader']>[0]
>;

type Handler = (event: unknown, ctx: ExtensionContext) => void;

type Command = Parameters<ExtensionAPI['registerCommand']>[1];

function make_theme(
	mode: 'truecolor' | '256color' = 'truecolor',
	accent = '#ff00b4',
): Theme {
	return new Theme(
		{
			accent,
			muted: '#888888',
			dim: '#666666',
			text: '#eeeeee',
			thinkingXhigh: '#9945ff',
			borderAccent: '#9945ff',
			mdHeading: '#00ffac',
			syntaxFunction: '#ccff00',
			thinkingHigh: '#ffbd2b',
			mdCode: '#42a0ff',
		} as ConstructorParameters<typeof Theme>[0],
		{
			userMessageBg: '#07020d',
			selectedBg: '#07020d',
		} as ConstructorParameters<typeof Theme>[1],
		mode,
	);
}

const theme = make_theme();

const info = {
	version: '0.6.0',
	model_id: 'test-model',
	project: 'my-project',
};

function plain(lines: string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trim());
}

function harness(mode: ExtensionContext['mode'] = 'tui') {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const set_header = vi.fn<ExtensionContext['ui']['setHeader']>();
	const request_render = vi.fn();

	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial SDK fixture; only exercised members are provided.
	const ctx = {
		mode,
		cwd: '/work/my-project',
		model: { id: 'first-model' },
		ui: { setHeader: set_header },
	} as unknown as ExtensionContext;

	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial SDK fixture; only exercised members are provided.
	startup_screen({
		on: (name: string, handler: Handler) =>
			handlers.set(name, handler),
		registerCommand: (name: string, command: Command) =>
			commands.set(name, command),
	} as unknown as ExtensionAPI);

	function component() {
		const factory = set_header.mock.calls.at(-1)?.[0];
		expect(factory).toBeTypeOf('function');

		return factory!(
			// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial SDK fixture; only exercised members are provided.
			{
				requestRender: request_render,
			} as unknown as Parameters<HeaderFactory>[0],
			theme,
		);
	}

	return {
		ctx,
		handlers,
		commands,
		set_header,
		request_render,
		component,
	};
}

describe('My-Pi splash rendering', () => {
	it('renders the original logo with live version, model and project fields', () => {
		const lines = render_splash(theme, 100, info);
		const text = plain(lines);
		expect(text).toContain('My-Pi v0.6.0');
		expect(text).toContain('test-model · my-project');
		expect(text[2]).toBe('');
		expect(text[9]).toBe('');
		expect(text.slice(3, 9)).toEqual(
			logo_lines.map((line) => line.trim()),
		);
		expect(lines.join('\n')).toContain('\x1b[38;2;');
	});

	it.each([0, 1, 5, 23, 24, 40, 41, 60, 100])(
		'fits terminal width %i, including wide Unicode names',
		(width) => {
			const lines = render_splash(theme, width, {
				...info,
				model_id: 'long-model-name-'.repeat(10),
				project: '项目🚀👩‍💻e\u0301'.repeat(20),
			});

			for (const line of lines)
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);

			if (width === 0) expect(lines).toEqual([]);
			else if (width < Math.max(...logo_lines.map(visibleWidth)))
				expect(lines).toHaveLength(2);
			else expect(lines).toHaveLength(12);
		},
	);

	it('uses Pi colour conversion on 256-colour terminals', () => {
		const indexed = make_theme('256color');
		const rendered = render_splash(indexed, 80, info).join('\n');
		expect(rendered).toContain('\x1b[38;5;');
		expect(rendered).not.toContain('\x1b[38;2;');
	});

	it('uses the theme supplied for each render instead of cached colours', () => {
		const other_theme = make_theme('truecolor', '#888888');
		expect(render_splash(other_theme, 80, info)).not.toEqual(
			render_splash(theme, 80, info),
		);
	});
});

describe('My-Pi splash lifecycle', () => {
	it('installs through setHeader and reads the launcher package version', () => {
		const state = harness();
		expect(state.set_header).not.toHaveBeenCalled();
		state.handlers.get('session_start')!({}, state.ctx);
		const header = state.component();

		const { version } = JSON.parse(
			readFileSync(
				new URL('../package.json', import.meta.url),
				'utf8',
			),
		);

		expect(plain(header.render(100))).toContain(`My-Pi v${version}`);
		expect(plain(header.render(100))).toContain(
			'first-model · my-project',
		);
		header.invalidate();
		expect(plain(header.render(100))).toContain(
			'first-model · my-project',
		);
	});

	it('updates the selected model and requests a redraw', () => {
		const state = harness();
		state.handlers.get('session_start')!({}, state.ctx);
		const header = state.component();
		state.handlers.get('model_select')!(
			{ model: { id: 'second-model' } },
			state.ctx,
		);
		expect(state.request_render).toHaveBeenCalledOnce();
		expect(plain(header.render(100))).toContain(
			'second-model · my-project',
		);
	});

	it('restores the upstream header and releases redraw callbacks on shutdown', () => {
		const state = harness();
		state.handlers.get('session_start')!({}, state.ctx);
		state.component();
		state.handlers.get('session_shutdown')!({}, state.ctx);
		expect(state.set_header).toHaveBeenLastCalledWith(undefined);
		state.handlers.get('model_select')!(
			{ model: { id: 'later-model' } },
			state.ctx,
		);
		expect(state.request_render).not.toHaveBeenCalled();
	});

	it('supports /builtin-header until the next session start', async () => {
		const state = harness();
		state.handlers.get('session_start')!({}, state.ctx);
		state.component();
		await state.commands
			.get('builtin-header')!
			.handler('', state.ctx as Parameters<Command['handler']>[1]);
		expect(state.set_header).toHaveBeenLastCalledWith(undefined);
		state.handlers.get('model_select')!(
			{ model: { id: 'later-model' } },
			state.ctx,
		);
		expect(state.request_render).not.toHaveBeenCalled();
		state.handlers.get('session_start')!({}, state.ctx);
		expect(plain(state.component().render(100))).toContain(
			'first-model · my-project',
		);
	});

	it.each(['print', 'json', 'rpc'] as const)(
		'does not install a terminal header in %s mode',
		(mode) => {
			const state = harness(mode);
			state.handlers.get('session_start')!({}, state.ctx);
			state.handlers.get('model_select')!(
				{ model: { id: 'other-model' } },
				state.ctx,
			);
			state.handlers.get('session_shutdown')!({}, state.ctx);
			expect(state.set_header).not.toHaveBeenCalled();
			expect(state.request_render).not.toHaveBeenCalled();
		},
	);

	it('handles missing models and session changes with a fresh project', () => {
		const state = harness();

		const next = {
			...state.ctx,
			model: undefined,
			cwd: '/work/another-project',
		};

		state.handlers.get('session_start')!({}, next);
		expect(plain(state.component().render(100))).toContain(
			'no model selected · another-project',
		);
	});
});
