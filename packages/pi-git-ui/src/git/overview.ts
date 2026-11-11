import { git } from './client.js';
import { format_git_error } from './errors.js';
import type { RepoOverview } from './types.js';

export async function read_repo_overview(
	cwd: string,
): Promise<RepoOverview> {
	const [branches, log, stashes, remotes] = await Promise.all([
		git(
			['branch', '--all', '--format=%(HEAD) %(refname:short)'],
			cwd,
		).catch((error) => format_git_error(error)),
		git(['log', '--oneline', '--decorate', '-n', '8'], cwd).catch(
			(error) => format_git_error(error),
		),
		git(['stash', 'list', '-n', '8'], cwd).catch((error) =>
			format_git_error(error),
		),
		git(['remote', '-v'], cwd).catch((error) =>
			format_git_error(error),
		),
	]);

	return {
		branches: split_non_empty(branches),
		log: split_non_empty(log),
		stashes: split_non_empty(stashes),
		remotes: split_non_empty(remotes),
	};
}

function split_non_empty(raw: string): string[] {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}
