import { show_picker_modal } from '@spences10/pi-tui-modal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { show_advanced_skills_modal } from './advanced.js';

vi.mock('@spences10/pi-tui-modal', () => ({
	show_picker_modal: vi.fn(),
	show_text_modal: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe('show_advanced_skills_modal', () => {
	it('reloads and exits after changing the default skill policy', async () => {
		vi.mocked(show_picker_modal)
			.mockResolvedValueOnce('defaults')
			.mockResolvedValueOnce('all-disabled');
		const set_defaults = vi.fn();
		const reload = vi.fn(async () => {});
		const ctx = {
			ui: { notify: vi.fn() },
			reload,
		} as unknown as Parameters<typeof show_advanced_skills_modal>[0];
		const mgr = {
			get_active_profile: () => 'default',
			set_defaults,
		};
		await expect(
			show_advanced_skills_modal(ctx, mgr as never),
		).resolves.toBe(true);
		expect(set_defaults).toHaveBeenCalledWith('all-disabled');
		expect(reload).toHaveBeenCalledOnce();
	});
});
