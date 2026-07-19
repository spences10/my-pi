import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	has: vi.fn(() => true),
	list: vi.fn(),
	tree: vi.fn(),
	preview: vi.fn(),
	install: vi.fn(),
	update: vi.fn(),
	progress: vi.fn(
		async (_ctx, _options, task) =>
			await task({
				signal: new AbortController().signal,
				update: vi.fn(),
			}),
	),
	picker: vi.fn(),
	text: vi.fn(),
	confirm: vi.fn(),
	notify: vi.fn(),
	reload: vi.fn(async () => {}),
}));

vi.mock('../gh-skill.js', async (original) => ({
	...(await original<typeof import('../gh-skill.js')>()),
	has_gh_skill: mocks.has,
	run_gh_skill_list_async: mocks.list,
	list_github_repository_skills_async: mocks.tree,
	run_gh_skill_preview_async: mocks.preview,
	run_gh_skill_install_async: mocks.install,
	run_gh_skill_update_async: mocks.update,
}));
vi.mock('@spences10/pi-tui-modal', () => ({
	run_with_progress_modal: mocks.progress,
	show_picker_modal: mocks.picker,
	show_text_modal: mocks.text,
	show_confirm_modal: mocks.confirm,
}));

import { show_available_skills_modal } from './available.js';

function ctx() {
	return {
		ui: { notify: mocks.notify },
		reload: mocks.reload,
	} as unknown as Parameters<typeof show_available_skills_modal>[0];
}

const installed = {
	skillName: 'existing',
	sourceURL: 'https://github.com/acme/skills',
	scope: 'user' as const,
	version: 'abc',
	pinned: false,
	path: '/tmp/existing',
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.has.mockReturnValue(true);
	mocks.list.mockResolvedValue([installed]);
	mocks.tree.mockResolvedValue([
		{ name: 'existing', path: 'existing/SKILL.md' },
		{ name: 'new-skill', path: 'new-skill/SKILL.md' },
	]);
	mocks.preview.mockResolvedValue('review me');
	mocks.install.mockResolvedValue('installed');
});

describe('show_available_skills_modal', () => {
	it('requires preview, explicit confirmation, then installs and reloads', async () => {
		mocks.picker.mockResolvedValue(
			'new:acme/skills:new-skill/SKILL.md',
		);
		mocks.confirm.mockResolvedValue(true);
		const context = ctx();
		await expect(show_available_skills_modal(context)).resolves.toBe(
			true,
		);
		expect(mocks.preview).toHaveBeenCalledWith(
			'acme/skills',
			'new-skill/SKILL.md',
			undefined,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(mocks.text).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ text: 'review me' }),
		);
		expect(mocks.confirm).toHaveBeenCalled();
		expect(mocks.install).toHaveBeenCalled();
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	it('does not mutate when install confirmation is cancelled', async () => {
		mocks.picker.mockResolvedValue(
			'new:acme/skills:new-skill/SKILL.md',
		);
		mocks.confirm.mockResolvedValue(false);
		const context = ctx();
		await expect(show_available_skills_modal(context)).resolves.toBe(
			false,
		);
		expect(mocks.preview).toHaveBeenCalled();
		expect(mocks.install).not.toHaveBeenCalled();
		expect(mocks.reload).not.toHaveBeenCalled();
	});

	it('keeps successful inventory visible when a known repository fails', async () => {
		mocks.tree.mockRejectedValue(new Error('rate limited'));
		mocks.picker.mockResolvedValue(undefined);
		const context = ctx();
		await expect(show_available_skills_modal(context)).resolves.toBe(
			false,
		);
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining('acme/skills'),
			'warning',
		);
		expect(mocks.picker).toHaveBeenCalled();
	});

	it('degrades when gh skill is unavailable', async () => {
		mocks.has.mockReturnValue(false);
		const context = ctx();
		await expect(show_available_skills_modal(context)).resolves.toBe(
			false,
		);
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.stringContaining('gh v2.90.0+'),
			'warning',
		);
		expect(mocks.list).not.toHaveBeenCalled();
	});
});
