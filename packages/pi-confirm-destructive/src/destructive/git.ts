import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { GitRecoverability } from './types.js';

export function git(args: string[], cwd: string): string | undefined {
	try {
		return execFileSync('git', ['-C', cwd, ...args], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return undefined;
	}
}

function is_git_repo(cwd: string): boolean {
	return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

function is_same_or_parent(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function deletes_repository_root(cwd: string, path: string): boolean {
	const root = git(['rev-parse', '--show-toplevel'], cwd);
	if (!root) return false;
	return is_same_or_parent(resolve(cwd, path), root);
}

function directory_for_path(path: string): string {
	try {
		return statSync(path).isDirectory() ? path : dirname(path);
	} catch {
		return dirname(path);
	}
}

function find_containing_git_root(path: string): string | undefined {
	let candidate = directory_for_path(path);
	while (true) {
		const root = git(['rev-parse', '--show-toplevel'], candidate);
		if (root) return root;
		const parent = dirname(candidate);
		if (parent === candidate) return undefined;
		candidate = parent;
	}
}

export function is_git_protected_path(
	cwd: string,
	path: string,
): boolean {
	const absolute = resolve(cwd, path);
	const root = find_containing_git_root(absolute);
	if (!root) {
		const current_root = git(['rev-parse', '--show-toplevel'], cwd);
		if (!current_root) return false;
		const current_git_directory = git(
			['rev-parse', '--absolute-git-dir'],
			current_root,
		);
		return Boolean(
			is_same_or_parent(resolve(current_root, '.git'), absolute) ||
			(current_git_directory &&
				is_same_or_parent(current_git_directory, absolute)),
		);
	}

	const git_marker = resolve(root, '.git');
	const git_directory = git(
		['rev-parse', '--absolute-git-dir'],
		root,
	);
	if (
		is_same_or_parent(absolute, root) ||
		is_same_or_parent(git_marker, absolute) ||
		Boolean(
			git_directory && is_same_or_parent(git_directory, absolute),
		)
	) {
		return true;
	}

	const relative_path = relative(root, absolute);
	if (
		!relative_path ||
		relative_path.startsWith('..') ||
		isAbsolute(relative_path)
	) {
		return true;
	}
	const status = git(
		['status', '--porcelain=v1', '--', relative_path],
		root,
	);
	if (status === undefined) return true;
	return status
		.split('\n')
		.some((line) => line && !line.startsWith('??'));
}

export function get_git_recoverability(
	cwd: string,
	path: string,
): GitRecoverability {
	if (!is_git_repo(cwd)) return 'not-git';
	if (deletes_repository_root(cwd, path)) return 'repo-root';

	const status = git(['status', '--porcelain=v1', '--', path], cwd);
	if (status === undefined) return 'not-git';
	if (status.length > 0) {
		return status.split('\n').some((line) => line.startsWith('??'))
			? 'untracked'
			: 'tracked-dirty';
	}

	const ignored = git(
		[
			'ls-files',
			'--others',
			'--ignored',
			'--exclude-standard',
			'--',
			path,
		],
		cwd,
	);
	if (ignored) return 'ignored';

	const tracked = git(['ls-files', '--', path], cwd);
	return tracked ? 'tracked-clean' : 'untracked';
}

export function is_git_recoverable(
	cwd: string,
	path: string,
): boolean {
	return get_git_recoverability(cwd, path) === 'tracked-clean';
}
