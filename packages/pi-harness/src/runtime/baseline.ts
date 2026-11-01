import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { HarnessPolicy } from '../schema.js';

export function collect_git_changed_files(
	cwd: string,
	allow_non_git = false,
): string[] {
	let status: string;
	let root: string;
	try {
		root = execFileSync(
			'git',
			['-C', cwd, 'rev-parse', '--show-toplevel'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		).trimEnd();
		status = execFileSync(
			'git',
			[
				'--no-optional-locks',
				'-C',
				cwd,
				'status',
				'--porcelain=v1',
				'-z',
				'--untracked-files=all',
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		);
	} catch (error) {
		if (allow_non_git && !is_git_workspace(cwd)) return [];
		throw error;
	}
	const entries = status.split('\0');
	const paths: string[] = [];
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		if (!entry) continue;
		paths.push(relative(cwd, resolve(root, entry.slice(3))));
		if (/[RC]/.test(entry.slice(0, 2)))
			paths.push(relative(cwd, resolve(root, entries[++index])));
	}
	return [...new Set(paths)].sort();
}

export function file_state(
	cwd: string,
	path: string,
): string | undefined {
	const absolute_path = resolve(cwd, path);
	const index_state = execFileSync('git', [
		'--no-optional-locks',
		'--literal-pathspecs',
		'-C',
		cwd,
		'ls-files',
		'--stage',
		'-z',
		'--',
		path,
	]);
	const hash = createHash('sha256').update(index_state).update('\0');
	try {
		const stat = lstatSync(absolute_path);
		if (!stat.isFile() && !stat.isSymbolicLink()) return undefined;
		const content = stat.isSymbolicLink()
			? readlinkSync(absolute_path, { encoding: 'buffer' })
			: readFileSync(absolute_path);
		return hash
			.update(
				`${stat.isSymbolicLink() ? 'symlink' : 'file'}:${stat.mode & 0o7777}:`,
			)
			.update(content)
			.digest('hex');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR')
			return hash.update('missing').digest('hex');
		throw error;
	}
}

function is_git_workspace(cwd: string): boolean {
	try {
		execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
			stdio: 'ignore',
		});
		return true;
	} catch {
		return false;
	}
}

export function capture_baseline(
	cwd: string,
): Pick<
	HarnessPolicy,
	'baseline_changed_files' | 'baseline_file_states'
> {
	if (!is_git_workspace(cwd)) return { baseline_changed_files: [] };
	const baseline_changed_files = collect_git_changed_files(cwd);
	const baseline_file_states = Object.fromEntries(
		baseline_changed_files.flatMap((path) => {
			const state = file_state(cwd, path);
			return state === undefined ? [] : [[path, state]];
		}),
	);
	return { baseline_changed_files, baseline_file_states };
}

export function collect_task_changed_files(
	cwd: string,
	policy: HarnessPolicy,
): string[] {
	const states =
		resolve(cwd) === resolve(policy.cwd)
			? (policy.baseline_file_states ?? {})
			: {};
	return [
		...new Set([
			...collect_git_changed_files(
				cwd,
				policy.baseline_file_states === undefined,
			),
			...Object.keys(states),
		]),
	]
		.filter(
			(path) =>
				!Object.hasOwn(states, path) ||
				file_state(cwd, path) !== states[path],
		)
		.sort();
}

// Keep standalone review scripts independent of the installed package.
export function build_baseline_helpers(): string {
	return String.raw`
function collect_git_changed_files(cwd) {
  const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  const status = execFileSync('git', ['--no-optional-locks', '-C', cwd, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = status.split('\0');
  const paths = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    paths.push(relative(cwd, resolve(root, entry.slice(3))));
    if (/[RC]/.test(entry.slice(0, 2))) paths.push(relative(cwd, resolve(root, entries[++index])));
  }
  return [...new Set(paths)].sort();
}

function file_state(cwd, path) {
  const absolute_path = resolve(cwd, path);
  const index_state = execFileSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', cwd, 'ls-files', '--stage', '-z', '--', path]);
  const hash = createHash('sha256').update(index_state).update('\0');
  try {
    const stat = lstatSync(absolute_path);
    if (!stat.isFile() && !stat.isSymbolicLink()) return undefined;
    const content = stat.isSymbolicLink() ? readlinkSync(absolute_path, { encoding: 'buffer' }) : readFileSync(absolute_path);
    return hash.update((stat.isSymbolicLink() ? 'symlink' : 'file') + ':' + (stat.mode & 0o7777) + ':').update(content).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return hash.update('missing').digest('hex');
    throw error;
  }
}

function collect_task_changed_files(cwd, policy) {
  const states = resolve(cwd) === resolve(policy.cwd) ? policy.baseline_file_states ?? {} : {};
  return [...new Set([...collect_git_changed_files(cwd), ...Object.keys(states)])]
    .filter((path) => !Object.hasOwn(states, path) || file_state(cwd, path) !== states[path])
    .sort();
}
`;
}
