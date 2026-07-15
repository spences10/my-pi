import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import {
	show_confirm_modal,
	show_input_modal,
	show_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from './show.js';
import type { ModalTheme } from './types.js';

type CustomFactory = Parameters<
	ExtensionCommandContext['ui']['custom']
>[0];
type CustomFactoryArgs = Parameters<CustomFactory>;

const theme: ModalTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function create_ctx(result?: unknown, send_input?: string) {
	const notify = vi.fn();
	const custom = vi.fn(
		async (
			factory: Parameters<ExtensionCommandContext['ui']['custom']>[0],
			_options: Parameters<
				ExtensionCommandContext['ui']['custom']
			>[1],
		) => {
			let resolved = result;
			const component = await factory(
				{
					terminal: { rows: 24 },
					requestRender: vi.fn(),
				} as unknown as TUI,
				theme as unknown as CustomFactoryArgs[1],
				{} as CustomFactoryArgs[2],
				(value: unknown) => {
					resolved = value;
				},
			);
			(component as Component & { focused: boolean }).focused = true;
			component.render(80);
			if (send_input) component.handleInput?.(send_input);
			component.dispose?.();
			return resolved;
		},
	);
	return {
		ctx: {
			ui: {
				custom:
					custom as unknown as ExtensionCommandContext['ui']['custom'],
				notify,
			},
		},
		custom,
		notify,
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
