import { describe, expect, it } from 'vite-plus/test';
import { format_git_summary, type GitSummary } from './git.js';

const summary: GitSummary = {
	branch: 'main',
	dirty: 2,
	staged: 1,
	untracked: 3,
	ahead: 4,
	behind: 5,
};

describe('format_git_summary', () => {
	it('uses nerd font git glyphs for branch and worktree state', () => {
		expect(format_git_summary(summary)).toBe(' main 2 1 3 ⇡4 ⇣5');
	});

	it('can fall back to plain git symbols', () => {
		expect(format_git_summary(summary, 'plain')).toBe(
			'main ±2 ●1 ?3 ↑4 ↓5',
		);
	});
});
