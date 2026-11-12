import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { isFocusable, type Component } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	show_command_output_modal,
	show_confirm_modal,
	show_input_modal,
	show_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from './show.js';
import {
	make_keybindings,
	make_theme,
} from '../../../../tools/test-sdk.js';
import {
	make_terminal,
	make_tui,
} from '../../../../tools/test-terminal.js';

type CustomFactory = Parameters<
	ExtensionCommandContext['ui']['custom']
>[0];

type CustomFactoryArgs = Parameters<CustomFactory>;

type ModalTestResult = string | boolean | undefined;

type ModalTestFactory = (
	tui: CustomFactoryArgs[0],
	theme: CustomFactoryArgs[1],
	keybindings: CustomFactoryArgs[2],
	done: (result: ModalTestResult) => void,
) => ReturnType<CustomFactory>;

function create_ctx(
	result?: ModalTestResult,
	send_input?: string,
	terminal_rows = 24,
) {
	const notify = vi.fn();
	const rendered_lines: string[] = [];

	const custom = vi.fn(
		async (
			factory: ModalTestFactory,
			_options: Parameters<
				ExtensionCommandContext['ui']['custom']
			>[1],
		) => {
			let resolved = result;

			const component = await factory(
				make_tui(make_terminal({ rows: terminal_rows })).tui,
				make_theme(),
				make_keybindings(),
				(value) => {
					resolved = value;
				},
			);

			const focus_target: Component = component;

			if (isFocusable(focus_target)) focus_target.focused = true;
			rendered_lines.push(...component.render(100));

			if (send_input) component.handleInput?.(send_input);
			component.dispose?.();

			return resolved;
		},
	);

	return {
		ctx: {
			ui: {
				// SAFETY: each test passes the canned result of the type its show_* helper resolves with, so this mock's untyped result matches the helper's `custom<T>` call.
				custom: custom as ExtensionCommandContext['ui']['custom'],
				notify,
			},
		},
		custom,
		notify,
		rendered_lines,
	};
}

describe('show modal helpers', () => {
	it('passes overlay options and renders custom modal chrome', async () => {
		const { ctx, custom } = create_ctx(undefined, 'x');
		await expect(
			show_modal(
				ctx,
				{ title: 'Title', overlay_options: { width: '60%' } },
				({ done }) => ({
					render: () => ['body'],
					handleInput: () => done('done'),
					invalidate: vi.fn(),
				}),
			),
		).resolves.toBe('done');
		expect(custom.mock.calls[0]?.[1]).toMatchObject({
			overlay: true,
			overlayOptions: { width: '60%' },
		});
	});

	it('returns undefined and notifies for empty picker items', async () => {
		const { ctx, notify, custom } = create_ctx();
		await expect(
			show_picker_modal(ctx, {
				title: 'Pick',
				items: [],
				empty_message: 'Empty',
			}),
		).resolves.toBeUndefined();
		expect(notify).toHaveBeenCalledWith('Empty');
		expect(custom).not.toHaveBeenCalled();
	});

	it('cycles stock SettingsList values with left and right arrows', async () => {
		const on_change = vi.fn();
		await show_settings_modal(create_ctx(undefined, '\u001b[D').ctx, {
			title: 'Settings',
			items: [
				{
					id: 'alignment',
					label: 'Alignment',
					currentValue: 'left',
					values: ['left', 'center', 'right'],
				},
			],
			on_change,
		});

		expect(on_change).toHaveBeenCalledWith('alignment', 'right');
	});

	it('applies overrideable command-output layout defaults', async () => {
		const defaults = create_ctx(undefined, undefined, 40);
		await show_command_output_modal(defaults.ctx, {
			title: 'Output',
			text: Array.from(
				{ length: 25 },
				(_, index) => `line-${index}`,
			).join('\n'),
		});

		expect(defaults.custom.mock.calls[0]?.[1]).toMatchObject({
			overlay: true,
			overlayOptions: {
				width: '90%',
				minWidth: 72,
			},
		});
		expect(
			defaults.rendered_lines.filter((line) =>
				line.includes('line-'),
			),
		).toHaveLength(20);

		const overrides = create_ctx(undefined, undefined, 40);
		await show_command_output_modal(overrides.ctx, {
			title: 'Output',
			text: 'one\ntwo\nthree',
			max_visible_lines: 2,
			overlay_options: { width: '75%', minWidth: 55 },
		});

		expect(overrides.custom.mock.calls[0]?.[1]).toMatchObject({
			overlayOptions: { width: '75%', minWidth: 55 },
		});
		expect(
			overrides.rendered_lines.filter((line) =>
				/one|two|three/.test(line),
			),
		).toHaveLength(2);
	});

	it('wraps picker, text, input, and confirm flows', async () => {
		await expect(
			show_picker_modal(create_ctx('a').ctx, {
				title: 'Pick',
				items: [{ label: 'A', value: 'a' }],
			}),
		).resolves.toBe('a');
		await expect(
			show_text_modal(create_ctx().ctx, {
				title: 'Text',
				text: 'hello',
			}),
		).resolves.toBeUndefined();
		await expect(
			show_input_modal(create_ctx('typed').ctx, { title: 'Input' }),
		).resolves.toBe('typed');
		await expect(
			show_confirm_modal(create_ctx('confirm').ctx, {
				title: 'Confirm',
				message: 'Sure?',
			}),
		).resolves.toBe(true);
		await expect(
			show_confirm_modal(create_ctx('cancel').ctx, {
				title: 'Confirm',
				message: 'Sure?',
			}),
		).resolves.toBe(false);
	});
});
