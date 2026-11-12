import { execFileSync } from 'node:child_process';
import type { GitIconMode } from '../presets/types.js';

export interface GitSummary {
	branch?: string;
	dirty: number;
	staged: number;
	untracked: number;
	ahead: number;
	behind: number;
}

const GIT_ICONS = {
	nerd: {
		branch: ' ',
		dirty: '',
		staged: '',
		untracked: '',
		ahead: '⇡',
		behind: '⇣',
	},
	plain: {
		branch: '',
		dirty: '±',
		staged: '●',
		untracked: '?',
		ahead: '↑',
		behind: '↓',
	},
} as const satisfies Record<GitIconMode, Record<string, string>>;

export function get_git_summary(
	cwd: string,
	branch?: string,
): GitSummary {
	const summary: GitSummary = {
		branch,
		dirty: 0,
		staged: 0,
		untracked: 0,
		ahead: 0,
		behind: 0,
	};

	try {
		const output = execFileSync(
			'git',
			['status', '--porcelain=v1', '--branch'],
			{
				cwd,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 500,
			},
		);

		for (const line of output.split('\n')) {
			if (!line) continue;

			if (line.startsWith('## ')) {
				const match = line.match(/^## ([^.\s]+|[^.]+?)(?:\.\.\.)?/);

				if (match?.[1] && !summary.branch) summary.branch = match[1];
				const ahead = line.match(/ahead (\d+)/);
				const behind = line.match(/behind (\d+)/);
				summary.ahead = ahead ? Number(ahead[1]) : 0;
				summary.behind = behind ? Number(behind[1]) : 0;
				continue;
			}

			const index_status = line[0];
			const worktree_status = line[1];

			if (line.startsWith('??')) {
				summary.untracked += 1;
				continue;
			}

			if (index_status !== ' ') summary.staged += 1;

			if (worktree_status !== ' ') summary.dirty += 1;
		}
	} catch {
		return summary;
	}

	return summary;
}

export function format_git_summary(
	summary: GitSummary,
	icon_mode: GitIconMode = 'nerd',
): string | undefined {
	const icons = GIT_ICONS[icon_mode];
	const parts: string[] = [];

	if (summary.branch) parts.push(`${icons.branch}${summary.branch}`);

	if (summary.dirty) parts.push(`${icons.dirty}${summary.dirty}`);

	if (summary.staged) parts.push(`${icons.staged}${summary.staged}`);

	if (summary.untracked)
		parts.push(`${icons.untracked}${summary.untracked}`);

	if (summary.ahead) parts.push(`${icons.ahead}${summary.ahead}`);

	if (summary.behind) parts.push(`${icons.behind}${summary.behind}`);

	return parts.length > 0 ? parts.join(' ') : undefined;
}
