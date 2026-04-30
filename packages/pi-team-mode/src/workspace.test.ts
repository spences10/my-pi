import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepare_teammate_workspace } from './workspace.js';

let root: string;
let repo: string;
let team_root: string;

function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-workspace-'));
	repo = join(root, 'repo');
	team_root = join(root, 'team-root');
	execFileSync('git', ['init', repo]);
	git(repo, ['config', 'user.email', 'test@example.com']);
	git(repo, ['config', 'user.name', 'Test User']);
	writeFileSync(join(repo, 'README.md'), '# test\n');
	git(repo, ['add', 'README.md']);
	git(repo, ['commit', '-m', 'initial']);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('prepare_teammate_workspace', () => {
	it('uses the repo cwd for shared workspace mode', () => {
		const workspace = prepare_teammate_workspace({
			team_id: 'team-1',
			member: 'alice',
			repo_cwd: repo,
			team_root,
		});

		expect(workspace).toEqual({
			cwd: repo,
			workspace_mode: 'shared',
		});
	});

	it('creates and reuses per-member git worktrees without cleanup', () => {
		const workspace = prepare_teammate_workspace({
			team_id: 'team-1',
			member: 'alice',
			repo_cwd: repo,
			team_root,
			mode: 'worktree',
			branch: 'team/alice',
		});

		expect(workspace.workspace_mode).toBe('worktree');
		expect(workspace.branch).toBe('team/alice');
		expect(workspace.worktree_path).toBe(
			join(team_root, 'worktrees', 'team-1', 'alice'),
		);
		expect(existsSync(join(workspace.cwd, '.git'))).toBe(true);
		expect(git(workspace.cwd, ['branch', '--show-current'])).toBe(
			'team/alice',
		);

		writeFileSync(join(workspace.cwd, 'dirty.txt'), 'keep me\n');
		const reused = prepare_teammate_workspace({
			team_id: 'team-1',
			member: 'alice',
			repo_cwd: repo,
			team_root,
			mode: 'worktree',
			branch: 'team/alice',
		});

		expect(reused.cwd).toBe(workspace.cwd);
		expect(existsSync(join(workspace.cwd, 'dirty.txt'))).toBe(true);
	});
});
