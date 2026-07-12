import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOTER_STATE } from '../presets/types.js';
import { make_context } from '../test-utils.js';
import { register_footer_command } from './footer-command.js';

const modal_mocks = vi.hoisted(() => ({
	show_modal: vi.fn(),
	show_picker_modal: vi.fn(),
	show_settings_modal: vi.fn(),
}));

vi.mock('@spences10/pi-tui-modal', () => modal_mocks);

describe('register_footer_command', () => {
	beforeEach(() => {
		modal_mocks.show_modal.mockReset();
		modal_mocks.show_picker_modal.mockReset();
		modal_mocks.show_settings_modal.mockReset();
	});

	it('configures a dynamic status row and returns to the main menu', async () => {
		modal_mocks.show_settings_modal
			.mockImplementationOnce(async (_ctx, options) => {
				expect(
					options.items.map((item: { id: string }) => item.id),
				).toContain('status-layout');
				options.on_change('status-layout', 'configure');
			})
			.mockImplementationOnce(async (_ctx, options) => {
				expect(options.title).toBe('Status: mcp');
				expect(
					options.items.map((item: { id: string }) => item.id),
				).toEqual(['row', 'alignment', 'visibility']);
				options.on_change('row', '3');
				options.on_change('alignment', 'center');
			})
			.mockResolvedValueOnce(undefined);
		modal_mocks.show_picker_modal
			.mockImplementationOnce(async (_ctx, options) => {
				expect(
					options.items.map((item: { value: string }) => item.value),
				).toEqual(
					expect.arrayContaining(['harness', 'mcp', 'codex-usage']),
				);
				return 'mcp';
			})
			.mockResolvedValueOnce(undefined);
		const register_command = vi.fn();
		const state = {
			...DEFAULT_FOOTER_STATE,
			status_layout: Object.fromEntries(
				Object.entries(DEFAULT_FOOTER_STATE.status_layout).map(
					([key, placement]) => [key, { ...placement }],
				),
			),
		};
		register_footer_command(
			{ registerCommand: register_command } as never,
			state,
		);
		const command = register_command.mock.calls[0]?.[1];
		expect(command).toBeDefined();

		await command.handler('', make_context() as never);

		expect(state.status_layout.mcp).toEqual({
			row: 3,
			alignment: 'center',
			hidden: false,
		});
		expect(modal_mocks.show_picker_modal).toHaveBeenCalledTimes(2);
		expect(modal_mocks.show_settings_modal).toHaveBeenCalledTimes(3);
	});
});
