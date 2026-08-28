import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	relative,
	resolve,
} from 'node:path';
import { get_git_recoverability, is_git_recoverable } from './git.js';

function is_path_within(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

function is_missing_path_error(error: unknown): boolean {
	if (!error || typeof error !== 'object' || !('code' in error)) {
		return false;
	}
	return ['ENOENT', 'ENOTDIR'].includes(
		String((error as { code: unknown }).code),
	);
}

function resolve_existing_path_components(
	path: string,
): string | undefined {
	let candidate = resolve(path);
	const missing_segments: string[] = [];

	while (true) {
		try {
			const existing = realpathSync.native(candidate);
			return resolve(existing, ...missing_segments.reverse());
		} catch (error) {
			try {
				lstatSync(candidate);
				return undefined;
			} catch (lstat_error) {
				if (!is_missing_path_error(lstat_error)) return undefined;
			}
			if (!is_missing_path_error(error)) return undefined;
		}

		const parent = dirname(candidate);
		if (parent === candidate) return undefined;
		missing_segments.push(basename(candidate));
		candidate = parent;
	}
}

function has_parent_reference(path: string): boolean {
	return path.split(/[\\/]+/).includes('..');
}

export function is_specific_path(path: string): boolean {
	const trimmed = path.trim();
	return Boolean(
		trimmed && trimmed !== '.' && !has_parent_reference(trimmed),
	);
}

export function is_specific_literal_shell_path(
	path: string,
): boolean {
	const trimmed = path.trim();
	return (
		is_specific_path(trimmed) &&
		!trimmed.startsWith('~') &&
		!trimmed.includes(String.fromCodePoint(0)) &&
		!/[*?[\]$`{}()!]/.test(trimmed)
	);
}

export function is_temp_path(path: string): boolean {
	const temp_root = resolve(tmpdir());
	const absolute = resolve(path);
	return (
		absolute === temp_root || is_path_within(temp_root, absolute)
	);
}

export function is_disposable_temp_path(
	cwd: string,
	path: string,
	options: { shell?: boolean } = {},
): boolean {
	if (
		!isAbsolute(path) ||
		!is_specific_path(path) ||
		(options.shell && !is_specific_literal_shell_path(path))
	) {
		return false;
	}

	const temp_root = resolve_existing_path_components(tmpdir());
	const target = resolve_existing_path_components(resolve(cwd, path));
	return Boolean(
		temp_root && target && is_path_within(temp_root, target),
	);
}

export function is_session_created_path(
	cwd: string,
	path: string,
	session_created_paths: ReadonlySet<string>,
): boolean {
	const absolute = resolve(cwd, path);
	if (session_created_paths.has(absolute)) return true;

	const target = resolve_existing_path_components(absolute);
	if (!target) return false;

	for (const created_path of session_created_paths) {
		const root = resolve(created_path);
		if (!is_path_within(root, absolute)) continue;
		try {
			const stat = lstatSync(root);
			if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
		} catch {
			continue;
		}
		const resolved_root = resolve_existing_path_components(root);
		if (resolved_root && is_path_within(resolved_root, target)) {
			return true;
		}
	}
	return false;
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
