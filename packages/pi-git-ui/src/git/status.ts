import { git } from './client.js';
import type { FileState, GitFile, GitStatus } from './types.js';

export async function read_status(cwd: string): Promise<GitStatus> {
	const [branch, upstream, raw] = await Promise.all([
		git(['branch', '--show-current'], cwd).catch(() => 'detached'),
		git(
			[
				'rev-parse',
				'--abbrev-ref',
				'--symbolic-full-name',
				'@{upstream}',
			],
			cwd,
		).catch(() => ''),
		git(['status', '--porcelain=v1', '-z'], cwd),
	]);

	const counts = upstream.trim()
		? await read_ahead_behind(cwd)
		: { ahead: 0, behind: 0 };

	return {
		branch: branch.trim() || 'detached',
		upstream: upstream.trim() || undefined,
		...counts,
		files: parse_porcelain_z(raw),
	};
}

async function read_ahead_behind(
	cwd: string,
): Promise<{ ahead: number; behind: number }> {
	const raw = await git(
		['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
		cwd,
	).catch(() => '');

	const [behind = '0', ahead = '0'] = raw.trim().split(/\s+/);

	return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}

export function parse_porcelain_z(raw: string): GitFile[] {
	if (!raw) return [];
	const entries = raw.split('\0').filter(Boolean);
	const files: GitFile[] = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const index_status = entry[0] ?? ' ';
		const worktree_status = entry[1] ?? ' ';
		let path = entry.slice(3);

		if (index_status === 'R' || index_status === 'C') {
			const original = entries[++i];

			if (original) path = `${original} → ${path}`;
		}

		files.push({
			path,
			index_status,
			worktree_status,
			state: get_file_state(index_status, worktree_status),
		});
	}

	return files.sort(
		(a, b) =>
			state_rank(a.state) - state_rank(b.state) ||
			a.path.localeCompare(b.path),
	);
}

function get_file_state(
	index_status: string,
	worktree_status: string,
): FileState {
	if (index_status === '?' && worktree_status === '?')
		return 'untracked';

	if (
		index_status === 'U' ||
		worktree_status === 'U' ||
		(index_status === 'A' && worktree_status === 'A') ||
		(index_status === 'D' && worktree_status === 'D')
	) {
		return 'conflicted';
	}

	const has_index = index_status !== ' ';
	const has_worktree = worktree_status !== ' ';

	if (has_index && has_worktree) return 'mixed';

	if (has_index) return 'staged';

	return 'changed';
}

function state_rank(state: FileState): number {
	return [
		'conflicted',
		'changed',
		'untracked',
		'mixed',
		'staged',
	].indexOf(state);
}

export function has_staged_changes(files: GitFile[]): boolean {
	return files.some(
		(file) => file.index_status !== ' ' && file.index_status !== '?',
	);
}

export function staged_file_count(files: GitFile[]): number {
	return files.filter(
		(file) => file.index_status !== ' ' && file.index_status !== '?',
	).length;
}
