import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
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
