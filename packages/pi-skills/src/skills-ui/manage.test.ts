import {
	show_picker_modal,
	show_settings_modal,
} from '@spences10/pi-tui-modal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	show_installed_skills_modal,
	show_skills_manager_modal,
} from './manage.js';

const scan_imported_skills = vi.hoisted(() => vi.fn(() => []));
vi.mock('@spences10/pi-skill-importer', () => ({
	scan_imported_skills,
}));

vi.mock('@spences10/pi-tui-modal', () => ({
	show_settings_modal: vi.fn(async (_ctx, options) => {
		options.on_change('skill-a', '○ disabled');
	}),
	show_picker_modal: vi.fn(),
	show_confirm_modal: vi.fn(),
	show_text_modal: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function create_ctx() {
	const notify = vi.fn();
	const reload = vi.fn(async () => {});
	const ctx = {
		ui: { notify },
		reload,
	} as unknown as Parameters<typeof show_skills_manager_modal>[0];
	return { ctx, notify, reload };
}

describe('show_skills_manager_modal', () => {
	it('notifies when no managed skills exist', async () => {
		const { ctx, notify } = create_ctx();
		const mgr = { discover: () => [] };
		await expect(
			show_skills_manager_modal(
				ctx,
				mgr as unknown as Parameters<
					typeof show_skills_manager_modal
				>[1],
			),
		).resolves.toBe(false);
		expect(notify).toHaveBeenCalledWith('No managed skills found');
	});

	it('opens settings, applies changes, and reloads when enabled set changes', async () => {
		const { ctx, notify, reload } = create_ctx();
		const disable = vi.fn();
		const mgr = {
			discover: () => [
				{
					key: 'skill-a',
					name: 'Skill A',
					description: 'Desc',
					source: 'local',
					enabled: true,
					baseDir: '/tmp/a',
				},
			],
			get_active_profile: () => 'default',
			enable: vi.fn(),
			disable,
		};
		await expect(
			show_skills_manager_modal(
				ctx,
				mgr as unknown as Parameters<
					typeof show_skills_manager_modal
				>[1],
			),
		).resolves.toBe(true);
		expect(show_settings_modal).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({
				title: 'Installed skill enablement',
				enable_search: true,
			}),
		);
		const options = vi
			.mocked(show_settings_modal)
			.mock.calls.at(-1)?.[1];
		expect(options?.items[0]?.values).toEqual([
			'● enabled',
			'○ disabled',
		]);
		expect(disable).toHaveBeenCalledWith('skill-a');
		expect(notify).toHaveBeenCalledWith(
			'Reloading to apply updated skills...',
			'info',
		);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('never offers generic manager deletion for importer-owned copies', async () => {
		const imported = {
			name: 'Skill A',
			baseDir: '/tmp/a',
			import_meta: { source: 'plugin:acme' },
		};
		scan_imported_skills.mockReturnValue([imported] as never);
		vi.mocked(show_picker_modal)
			.mockResolvedValueOnce('details')
			.mockResolvedValueOnce('skill-a')
			.mockResolvedValueOnce(undefined);
		const delete_skill = vi.fn();
		const mgr = {
			discover: () => [
				{
					key: 'skill-a',
					name: 'Skill A',
					description: 'Desc',
					source: 'pi-native',
					enabled: true,
					baseDir: '/tmp/a',
				},
			],
			get_active_profile: () => 'default',
			delete_skill,
		};
		const { ctx } = create_ctx();
		await expect(
			show_installed_skills_modal(ctx, mgr as never),
		).resolves.toBe(false);
		const detail_options =
			vi.mocked(show_picker_modal).mock.calls[2]?.[1];
		expect(detail_options?.items.map((item) => item.value)).toEqual([
			'details',
		]);
		expect(delete_skill).not.toHaveBeenCalled();
	});
});
