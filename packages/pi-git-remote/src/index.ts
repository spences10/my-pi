import { execFileSync } from 'node:child_process';

export function parse_github_repo(
	remote: string,
): string | undefined {
	const trimmed = remote.trim().replace(/\.git$/, '');
	const match =
		/^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed) ??
		/^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(trimmed) ??
		/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed);
	if (!match) return undefined;
	return `${match[1]}/${match[2]}`.toLowerCase();
}

export function get_github_repos(cwd: string): string[] {
	try {
		const output = execFileSync('git', ['remote', '-v'], {
			cwd,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return [
			...new Set(
				output
					.split('\n')
					.map((line) => line.trim().split(/\s+/)[1])
					.filter((remote): remote is string => Boolean(remote))
					.map(parse_github_repo)
					.filter((repo): repo is string => Boolean(repo)),
			),
		];
	} catch {
		return [];
	}
}
