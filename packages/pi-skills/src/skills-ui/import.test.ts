import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	scanExternal: vi.fn(),
	scanImported: vi.fn(),
	status: vi.fn(),
	importSkill: vi.fn(),
	syncSkill: vi.fn(),
	deleteSkill: vi.fn(),
	picker: vi.fn(),
	text: vi.fn(),
	confirm: vi.fn(),
	progress: vi.fn(
		async (_ctx, _options, task) =>
			await task({ signal: new AbortController().signal }),
	),
	github: vi.fn(),
	notify: vi.fn(),
	reload: vi.fn(async () => {}),
}));

vi.mock('@spences10/pi-skill-importer', () => ({
	scan_importable_skills: mocks.scanExternal,
	scan_imported_skills: mocks.scanImported,
	get_imported_skill_sync_status: mocks.status,
	import_external_skill: mocks.importSkill,
	sync_imported_skill: mocks.syncSkill,
	delete_imported_skill: mocks.deleteSkill,
}));
vi.mock('@spences10/pi-tui-modal', () => ({
	show_picker_modal: mocks.picker,
	show_text_modal: mocks.text,
	show_confirm_modal: mocks.confirm,
	run_with_progress_modal: mocks.progress,
}));
vi.mock('./github.js', () => ({
	show_add_github_skill_modal: mocks.github,
}));

import { show_add_import_modal } from './import.js';

function ctx() {
	return {
		ui: { notify: mocks.notify },
		reload: mocks.reload,
	} as unknown as Parameters<typeof show_add_import_modal>[0];
}

const imported = {
	name: 'imported',
	description: 'desc',
	source: 'pi-native',
	scope: 'global',
	kind: 'managed',
	skillPath: '/managed/imported/SKILL.md',
	baseDir: '/managed/imported',
	import_meta: {
		source: 'plugin:acme',
		upstream_base_dir: '/upstream/imported',
	},
};

const external = {
	name: 'external',
	description: 'desc',
	source: 'plugin:acme',
	scope: 'plugin',
	kind: 'external',
	skillPath: '/upstream/SKILL.md',
	baseDir: '/upstream',
	plugin: {
		pluginId: 'acme',
		installPath: '/plugin',
		version: '1.0.0',
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.scanExternal.mockReturnValue([external]);
	mocks.scanImported.mockReturnValue([]);
	mocks.status.mockReturnValue({
		status: 'update-available',
		detail: 'Upstream changed',
	});
});

describe('show_add_import_modal', () => {
	it('reviews and confirms before composing the importer mutation API', async () => {
		mocks.picker
			.mockResolvedValueOnce('external')
			.mockResolvedValueOnce('plugin:acme/external');
		mocks.confirm.mockResolvedValue(true);
		mocks.importSkill.mockReturnValue({
			skillDir: '/managed/external',
		});
		const context = ctx();
		await expect(show_add_import_modal(context)).resolves.toBe(true);
		expect(mocks.text).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ title: 'Review external' }),
		);
		expect(mocks.confirm).toHaveBeenCalled();
		expect(mocks.importSkill).toHaveBeenCalledWith(external);
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	it('does not import without explicit confirmation', async () => {
		mocks.picker
			.mockResolvedValueOnce('external')
			.mockResolvedValueOnce('plugin:acme/external');
		mocks.confirm.mockResolvedValue(false);
		const context = ctx();
		await expect(show_add_import_modal(context)).resolves.toBe(false);
		expect(mocks.importSkill).not.toHaveBeenCalled();
		expect(mocks.reload).not.toHaveBeenCalled();
	});

	it('confirms before composing safe sync/rebind and reloads changed copies', async () => {
		mocks.scanImported.mockReturnValue([imported]);
		mocks.picker
			.mockResolvedValueOnce('imported')
			.mockResolvedValueOnce('pi-native/imported')
			.mockResolvedValueOnce('sync');
		mocks.confirm.mockResolvedValue(true);
		mocks.syncSkill.mockReturnValue({ changed: true });
		const context = ctx();
		await expect(show_add_import_modal(context)).resolves.toBe(true);
		expect(mocks.confirm).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ confirm_label: 'Sync' }),
		);
		expect(mocks.syncSkill).toHaveBeenCalledWith(imported);
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	it('uses only metadata-owned importer deletion after confirmation', async () => {
		mocks.scanImported.mockReturnValue([imported]);
		mocks.picker
			.mockResolvedValueOnce('imported')
			.mockResolvedValueOnce('pi-native/imported')
			.mockResolvedValueOnce('delete');
		mocks.confirm.mockResolvedValue(true);
		const context = ctx();
		await expect(show_add_import_modal(context)).resolves.toBe(true);
		expect(mocks.confirm).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ confirm_label: 'Delete copy' }),
		);
		expect(mocks.deleteSkill).toHaveBeenCalledWith(imported);
		expect(mocks.reload).toHaveBeenCalledOnce();
	});
});
