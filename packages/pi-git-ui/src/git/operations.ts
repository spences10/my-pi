import { git } from './client.js';
import type { GitFile } from './types.js';

export function git_path(file: GitFile): string {
	const arrow = ' → ';

	return file.path.includes(arrow)
		? file.path.split(arrow).at(-1)!
		: file.path;
}

export async function stage_file(
	cwd: string,
	file: GitFile,
): Promise<void> {
	await git(['add', '--', git_path(file)], cwd);
}

export async function unstage_file(
	cwd: string,
	file: GitFile,
): Promise<void> {
	await git(['restore', '--staged', '--', git_path(file)], cwd);
}

export async function toggle_file(
	cwd: string,
	file: GitFile,
): Promise<void> {
	if (file.state === 'mixed') {
		throw new Error(
			'Partial file: space is disabled. Use s to stage worktree changes or x to unstage staged changes.',
		);
	}

	if (file.state === 'conflicted') {
		throw new Error(
			'Conflicted file: resolve conflicts, then stage explicitly with s.',
		);
	}

	if (file.state === 'staged') await unstage_file(cwd, file);
	else await stage_file(cwd, file);
}

export async function stage_all(cwd: string): Promise<void> {
	await git(['add', '--all'], cwd);
}

export async function unstage_all(cwd: string): Promise<void> {
	await git(['restore', '--staged', '--', ':/'], cwd);
}

export async function discard_file(
	cwd: string,
	file: GitFile,
): Promise<void> {
	const path = git_path(file);

	if (file.state === 'untracked')
		await git(['clean', '-f', '--', path], cwd);
	else await git(['restore', '--worktree', '--', path], cwd);
}

export async function commit(
	cwd: string,
	message: string,
	options: { amend?: boolean } = {},
): Promise<void> {
	const args = ['commit'];

	if (options.amend) args.push('--amend');
	args.push('-m', message);
	await git(args, cwd);
}
