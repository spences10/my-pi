import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	has: vi.fn(() => true),
	preview: vi.fn(),
	install: vi.fn(),
	tree: vi.fn(),
	input: vi.fn(),
	picker: vi.fn(),
	text: vi.fn(),
	confirm: vi.fn(),
	progress: vi.fn(
		async (_ctx, _options, task) =>
			await task({
				signal: new AbortController().signal,
				update: vi.fn(),
			}),
	),
	reload: vi.fn(async () => {}),
	notify: vi.fn(),
}));

vi.mock('../gh-skill.js', async (original) => ({
	...(await original<typeof import('../gh-skill.js')>()),
	has_gh_skill: mocks.has,
	run_gh_skill_preview_async: mocks.preview,
	run_gh_skill_install_async: mocks.install,
	list_github_repository_skills_async: mocks.tree,
}));
vi.mock('@spences10/pi-tui-modal', () => ({
	run_with_progress_modal: mocks.progress,
	show_input_modal: mocks.input,
	show_picker_modal: mocks.picker,
	show_text_modal: mocks.text,
	show_confirm_modal: mocks.confirm,
}));

import { show_add_github_skill_modal } from './github.js';

const ctx = {
	ui: { notify: mocks.notify },
	reload: mocks.reload,
} as unknown as Parameters<typeof show_add_github_skill_modal>[0];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.has.mockReturnValue(true);
	mocks.input
		.mockResolvedValueOnce('acme/skills')
		.mockResolvedValueOnce('new/SKILL.md');
	mocks.picker.mockResolvedValue('one');
	mocks.preview.mockResolvedValue('review me');
	mocks.install.mockResolvedValue('installed');
	mocks.tree.mockResolvedValue([
		{ name: 'new', path: 'nested/new/SKILL.md' },
	]);
});

describe('GitHub add flow', () => {
	it('previews, confirms, mutates, then reloads', async () => {
		mocks.confirm.mockResolvedValue(true);
		await expect(show_add_github_skill_modal(ctx)).resolves.toBe(
			true,
		);
		expect(mocks.preview).toHaveBeenCalled();
		expect(mocks.text).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({ text: 'review me' }),
		);
		expect(mocks.confirm).toHaveBeenCalled();
		expect(mocks.install).toHaveBeenCalled();
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	it('previews pinned install-all content with the exact @version argument', async () => {
		mocks.input.mockReset();
		mocks.input
			.mockResolvedValueOnce('acme/skills')
			.mockResolvedValueOnce('main');
		mocks.picker.mockReset();
		mocks.picker
			.mockResolvedValueOnce('all')
			.mockResolvedValueOnce('pin')
			.mockResolvedValueOnce('skip');
		mocks.confirm.mockResolvedValue(true);
		await expect(show_add_github_skill_modal(ctx)).resolves.toBe(
			true,
		);
		expect(mocks.preview).toHaveBeenCalledWith(
			'acme/skills',
			'nested/new/SKILL.md@main',
			undefined,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(mocks.install).toHaveBeenCalledWith(
			expect.objectContaining({
				skill: 'nested/new/SKILL.md',
				flags: ['--pin', 'main'],
			}),
			undefined,
			expect.anything(),
		);
	});

	it('does not install when confirmation is cancelled', async () => {
		mocks.confirm.mockResolvedValue(false);
		await expect(show_add_github_skill_modal(ctx)).resolves.toBe(
			false,
		);
		expect(mocks.preview).toHaveBeenCalled();
		expect(mocks.install).not.toHaveBeenCalled();
		expect(mocks.reload).not.toHaveBeenCalled();
	});
});
