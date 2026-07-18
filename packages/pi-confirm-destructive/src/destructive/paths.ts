import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { get_git_recoverability, is_git_recoverable } from './git.js';

function is_path_within(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

export function is_temp_path(path: string): boolean {
	const temp_root = resolve(tmpdir());
	const absolute = resolve(path);
	return (
		absolute === temp_root || is_path_within(temp_root, absolute)
	);
}

export function is_agent_temp_path(path: string): boolean {
	if (!is_temp_path(path)) return false;
	const temp_root = resolve(tmpdir());
	const first_segment = relative(temp_root, resolve(path)).split(
		/[\\/]+/,
	)[0];
	return /^my-pi-(audit|sandbox|temp|tmp|work|session)-/.test(
		first_segment,
	);
}

export function describe_path_risk(
	cwd: string,
	paths: string[],
): string {
	const risky = paths.filter(
		(path) => !is_git_recoverable(cwd, path),
	);
	if (risky.length === 0) return 'Deletes git-recoverable files';

	const risks = new Set(
		risky.map((path) => get_git_recoverability(cwd, path)),
	);
	if (risks.has('repo-root')) {
		return 'Deletes the repository root, including git metadata';
	}
	if (risks.has('ignored')) {
		return 'Deletes ignored files or directories that git cannot restore';
	}
	if (risks.has('untracked')) {
		return 'Deletes untracked files or directories that git cannot restore';
	}
	if (risks.has('tracked-dirty')) {
		return 'Deletes files with uncommitted changes';
	}
	return 'Deletes files outside git recovery';
}
