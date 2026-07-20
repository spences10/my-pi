import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { get_github_repos, parse_github_repo } from './index.js';

const dirs: string[] = [];

function tmp_dir(): string {
	const dir = join(
		tmpdir(),
		`my-pi-git-remote-${Date.now()}-${Math.random()}`,
	);
	mkdirSync(dir, { recursive: true });
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('parse_github_repo', () => {
	it.each([
		['git@github.com:Owner/Repo.git', 'owner/repo'],
		['https://github.com/Owner/Repo.git', 'owner/repo'],
		['ssh://git@github.com/Owner/Repo.git', 'owner/repo'],
	])('parses supported GitHub remote %s', (remote, expected) => {
		expect(parse_github_repo(remote)).toBe(expected);
	});

	it.each([
		'http://github.com/owner/repo.git',
		'git://github.com/owner/repo.git',
		'https://gitlab.com/owner/repo.git',
		'owner/repo',
	])('ignores unsupported remote %s', (remote) => {
		expect(parse_github_repo(remote)).toBeUndefined();
	});
});

describe('get_github_repos', () => {
	it('deduplicates GitHub fetch and push remotes and ignores other hosts', () => {
		const cwd = tmp_dir();
		execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
		execFileSync(
			'git',
			['remote', 'add', 'origin', 'git@github.com:Owner/Repo.git'],
			{ cwd, stdio: 'ignore' },
		);
		execFileSync(
			'git',
			[
				'remote',
				'add',
				'mirror',
				'https://github.com/owner/repo.git',
			],
			{ cwd, stdio: 'ignore' },
		);
		execFileSync(
			'git',
			['remote', 'add', 'other', 'https://gitlab.com/owner/repo.git'],
			{ cwd, stdio: 'ignore' },
		);

		expect(get_github_repos(cwd)).toEqual(['owner/repo']);
	});

	it('returns an empty list when git remote inspection fails', () => {
		expect(get_github_repos(join(tmp_dir(), 'missing'))).toEqual([]);
	});
});
