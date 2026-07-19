import { show_picker_modal } from '@spences10/pi-tui-modal';
import { describe, expect, it, vi } from 'vitest';
import { show_skills_home_modal } from './home.js';

vi.mock('@spences10/pi-tui-modal', () => ({
	show_picker_modal: vi.fn(async () => 'installed'),
}));

describe('show_skills_home_modal', () => {
	it('builds the skills home menu with counts and actions', async () => {
		await expect(
			show_skills_home_modal(
				{} as unknown as Parameters<typeof show_skills_home_modal>[0],
				{
					managed: 3,
					enabled: 2,
					external: 4,
					imported: 1,
				},
				'default',
			),
		).resolves.toBe('installed');
		expect(show_picker_modal).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				title: 'Skills',
				subtitle: '3 installed • 2 enabled • profile default',
				footer: 'enter opens • esc close/back',
				items: [
					expect.objectContaining({
						value: 'installed',
						label: 'Installed',
					}),
					expect.objectContaining({
						value: 'available',
						label: 'Available',
					}),
					expect.objectContaining({
						value: 'add-import',
						label: 'Add / import',
					}),
					expect.objectContaining({
						value: 'advanced',
						label: 'Advanced',
					}),
				],
			}),
		);
	});
});
