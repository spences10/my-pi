import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TeamWorkspaceMode } from './store.js';

export interface TeammateWorkspaceInput {
	team_id: string;
	member: string;
	repo_cwd: string;
	team_root: string;
	mode?: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
}

export interface PreparedTeammateWorkspace {
	cwd: string;
	workspace_mode: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
}

interface GitWorktree {
	path: string;
	branch?: string;
}

function safe_ref_segment(value: string): string {
	return value
		.trim()
		.replace(/[^a-zA-Z0-9_.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

function default_branch(team_id: string, member: string): string {
	return `team/${safe_ref_segment(team_id)}/${safe_ref_segment(member)}`;
}

function default_worktree_path(
	team_root: string,
	team_id: string,
	member: string,
): string {
	return join(
		resolve(team_root),
		'worktrees',
		safe_ref_segment(team_id),
		safe_ref_segment(member),
	);
}

function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function repo_root(cwd: string): string {
	try {
		return git(cwd, ['rev-parse', '--show-toplevel']);
	} catch (error) {
		throw new Error(
			`Cannot create teammate worktree because ${cwd} is not inside a git repository.`,
			{ cause: error },
		);
	}
}

function is_git_worktree(path: string): boolean {
	try {
		return (
			git(path, ['rev-parse', '--is-inside-work-tree']) === 'true'
		);
	} catch {
		return false;
	}
}

function normalize_branch_ref(value: string): string {
	return value.replace(/^refs\/heads\//, '');
}

function list_git_worktrees(repo: string): GitWorktree[] {
	const output = git(repo, ['worktree', 'list', '--porcelain']);
	const worktrees: GitWorktree[] = [];
	let current: GitWorktree | undefined;
	for (const line of output.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = { path: resolve(line.slice('worktree '.length)) };
			worktrees.push(current);
		} else if (current && line.startsWith('branch ')) {
			current.branch = normalize_branch_ref(
				line.slice('branch '.length),
			);
		}
	}
	return worktrees;
}

function validate_worktree_reuse(
	repo: string,
	path: string,
	branch: string,
): void {
	const resolved_path = resolve(path);
	const worktrees = list_git_worktrees(repo);
	const same_path = worktrees.find(
		(worktree) => resolve(worktree.path) === resolved_path,
	);
	const same_branch = worktrees.find(
		(worktree) =>
			worktree.branch === branch &&
			resolve(worktree.path) !== resolved_path,
	);

	if (same_branch) {
		throw new Error(
			`Worktree branch ${branch} is already checked out at ${same_branch.path}. Choose a different branch for this teammate.`,
		);
	}

	if (same_path?.branch && same_path.branch !== branch) {
		throw new Error(
			`Worktree path ${resolved_path} is already attached to branch ${same_path.branch}; requested ${branch}. Choose a different worktree path or branch.`,
		);
	}
}

function create_or_reuse_worktree(
	repo: string,
	path: string,
	branch: string,
): void {
	validate_worktree_reuse(repo, path, branch);

	if (existsSync(path)) {
		if (!is_git_worktree(path)) {
			throw new Error(
				`Worktree path already exists and is not a git worktree: ${path}`,
			);
		}
		return;
	}

	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	try {
		git(repo, ['worktree', 'add', '-b', branch, path, 'HEAD']);
	} catch {
		git(repo, ['worktree', 'add', path, branch]);
	}
}

export function prepare_teammate_workspace(
	input: TeammateWorkspaceInput,
): PreparedTeammateWorkspace {
	const mode = input.mode ?? 'shared';
	if (mode === 'shared') {
		return { cwd: resolve(input.repo_cwd), workspace_mode: 'shared' };
	}

	const repo = repo_root(input.repo_cwd);
	const branch =
		input.branch?.trim() ||
		default_branch(input.team_id, input.member);
	const worktree_path = input.worktree_path
		? resolve(repo, input.worktree_path)
		: default_worktree_path(
				input.team_root,
				input.team_id,
				input.member,
			);
	create_or_reuse_worktree(repo, worktree_path, branch);
	return {
		cwd: worktree_path,
		workspace_mode: 'worktree',
		branch,
		worktree_path,
	};
}
