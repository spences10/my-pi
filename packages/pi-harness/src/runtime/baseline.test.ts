import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	amend_harness_runtime,
	create_harness_runtime,
} from './index.js';
import { collect_harness_outcome } from './outcome.js';

const cleanup_paths: string[] = [];

function temp_dir(): string {
	const path = mkdtempSync(join(tmpdir(), 'pi-harness-baseline-'));
	cleanup_paths.push(path);
	return path;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		'git',
		['--no-optional-locks', '-C', cwd, ...args],
		{
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
}

function project(): string {
	const cwd = temp_dir();
	git(cwd, 'init');
	git(cwd, 'config', 'user.email', 'test@example.com');
	git(cwd, 'config', 'user.name', 'Test');
	mkdirSync(join(cwd, 'src'));
	writeFileSync(
		join(cwd, 'src/index.ts'),
		'export const value = 1;\n',
	);
	writeFileSync(join(cwd, 'README.md'), '# original\n');
	git(cwd, 'add', '.');
	git(
		cwd,
		'-c',
		'core.hooksPath=/dev/null',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-m',
		'baseline',
	);
	return cwd;
}

function harness(cwd: string, allowed_paths = ['src/**']) {
	const runtime = create_harness_runtime(
		{
			task: 'Baseline regression',
			allowed_paths,
			validation_commands: ['true'],
		},
		cwd,
	);
	cleanup_paths.push(runtime.harness_dir);
	return runtime;
}

function review(
	harness_dir: string,
	cwd: string,
	changed_files: string[],
	succeeds: boolean,
): void {
	const result = spawnSync('bash', [join(harness_dir, 'review.sh')], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, HARNESS_CWD: cwd },
	});
	expect(result.error).toBeUndefined();
	expect(result.status, result.stdout + result.stderr).toBe(
		succeeds ? 0 : 1,
	);
	const generated = JSON.parse(
		readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
	);
	expect(generated.changed_files).toEqual([...changed_files].sort());
	expect(
		collect_harness_outcome(harness_dir, cwd).changed_files,
	).toEqual(generated.changed_files);
}

afterEach(() => {
	for (const path of cleanup_paths.splice(0).reverse()) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe('post-baseline changes', () => {
	it('reports and rejects later out-of-scope edits to an already-dirty file', () => {
		const cwd = project();
		writeFileSync(join(cwd, 'README.md'), '# user edits\n');
		const { harness_dir } = harness(cwd);
		review(harness_dir, cwd, [], true);

		writeFileSync(join(cwd, 'README.md'), '# task edits\n');
		review(harness_dir, cwd, ['README.md'], false);
	});

	it('reports permitted further edits without recapturing the baseline on amendment', () => {
		const cwd = project();
		writeFileSync(
			join(cwd, 'src/index.ts'),
			'export const value = 2;\n',
		);
		const { harness_dir } = harness(cwd);
		writeFileSync(
			join(cwd, 'src/index.ts'),
			'export const value = 3;\n',
		);
		amend_harness_runtime({
			harness_dir,
			reason: 'Clarify validation',
			validation_commands: ['true'],
		});
		review(harness_dir, cwd, ['src/index.ts'], true);
	});

	it.each([
		[
			'delete dirty tracked file',
			(cwd: string) => rmSync(join(cwd, 'README.md')),
			['README.md'],
		],
		[
			'restore tracked HEAD content',
			(cwd: string) =>
				writeFileSync(join(cwd, 'README.md'), '# original\n'),
			['README.md'],
		],
		[
			'rename dirty tracked file',
			(cwd: string) =>
				renameSync(join(cwd, 'README.md'), join(cwd, 'renamed.md')),
			['README.md', 'renamed.md'],
		],
		[
			'edit initially untracked file',
			(cwd: string) =>
				writeFileSync(join(cwd, 'notes.md'), 'later\n'),
			['notes.md'],
		],
		[
			'delete initially untracked file',
			(cwd: string) => rmSync(join(cwd, 'notes.md')),
			['notes.md'],
		],
		[
			'rename initially untracked file',
			(cwd: string) =>
				renameSync(join(cwd, 'notes.md'), join(cwd, 'renamed.md')),
			['notes.md', 'renamed.md'],
		],
	] as const)('%s', (_name, mutate, expected) => {
		const cwd = project();
		writeFileSync(join(cwd, 'README.md'), '# user edits\n');
		writeFileSync(join(cwd, 'notes.md'), 'user notes\n');
		const { harness_dir } = harness(cwd);
		review(harness_dir, cwd, [], true);
		mutate(cwd);
		review(harness_dir, cwd, [...expected], false);
	});

	it('reports baseline files removed when their parent directory becomes a file', () => {
		const cwd = project();
		mkdirSync(join(cwd, 'notes'));
		writeFileSync(join(cwd, 'notes/user.md'), 'user notes\n');
		const { harness_dir } = harness(cwd);
		rmSync(join(cwd, 'notes'), { recursive: true });
		writeFileSync(join(cwd, 'notes'), 'replacement\n');
		review(harness_dir, cwd, ['notes', 'notes/user.md'], false);
	});

	it('tracks a baseline deletion when the file is restored', () => {
		const cwd = project();
		git(cwd, 'rm', 'README.md');
		const { harness_dir } = harness(cwd);
		review(harness_dir, cwd, [], true);
		writeFileSync(join(cwd, 'README.md'), '# restored\n');
		review(harness_dir, cwd, ['README.md'], false);
	});

	it('tracks both sides of a staged baseline rename', () => {
		const cwd = project();
		git(cwd, 'mv', 'README.md', 'renamed.md');
		const { harness_dir, contract } = harness(cwd);
		expect(contract.policy.baseline_changed_files).toEqual([
			'README.md',
			'renamed.md',
		]);
		review(harness_dir, cwd, [], true);
		writeFileSync(join(cwd, 'renamed.md'), '# edited destination\n');
		review(harness_dir, cwd, ['renamed.md'], false);
		writeFileSync(join(cwd, 'README.md'), '# recreated source\n');
		review(harness_dir, cwd, ['README.md', 'renamed.md'], false);
	});

	it('handles filenames that Git would otherwise quote', () => {
		const cwd = project();
		const name = 'notes "quoted"\nwith newline.md';
		writeFileSync(join(cwd, name), 'user notes\n');
		const { harness_dir } = harness(cwd);
		review(harness_dir, cwd, [], true);
		writeFileSync(join(cwd, name), 'task notes\n');
		review(harness_dir, cwd, [name], false);
	});

	it('detects index-only changes even when working-tree content stays unchanged', () => {
		const cwd = project();
		writeFileSync(join(cwd, 'README.md'), '# user edits\n');
		const { harness_dir } = harness(cwd);
		const blob = execFileSync(
			'git',
			['-C', cwd, 'hash-object', '-w', '--stdin'],
			{
				input: '# different staged content\n',
				encoding: 'utf8',
			},
		).trim();
		git(
			cwd,
			'update-index',
			'--cacheinfo',
			'100644',
			blob,
			'README.md',
		);
		review(harness_dir, cwd, ['README.md'], false);
		expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe(
			'# user edits\n',
		);
	});

	it('captures baseline state without changing files, HEAD or the Git index', () => {
		const cwd = project();
		writeFileSync(join(cwd, 'README.md'), '# staged\n');
		git(cwd, 'add', 'README.md');
		writeFileSync(join(cwd, 'README.md'), '# unstaged\n');
		writeFileSync(join(cwd, 'notes.md'), 'untracked\n');
		const index = join(cwd, '.git/index');
		const index_before = readFileSync(index);
		const mtime_before = lstatSync(index).mtimeMs;
		const head_before = git(cwd, 'rev-parse', 'HEAD');
		const status_before = git(cwd, 'status', '--porcelain=v1', '-z');
		harness(cwd);
		expect(readFileSync(index)).toEqual(index_before);
		expect(lstatSync(index).mtimeMs).toBe(mtime_before);
		expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head_before);
		expect(git(cwd, 'status', '--porcelain=v1', '-z')).toBe(
			status_before,
		);
		expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe(
			'# unstaged\n',
		);
		expect(readFileSync(join(cwd, 'notes.md'), 'utf8')).toBe(
			'untracked\n',
		);
	});

	it('does not apply another worktree’s dirty-file baseline', () => {
		const cwd = project();
		const worktree = temp_dir();
		git(cwd, 'worktree', 'add', '-b', 'task', worktree);
		writeFileSync(join(cwd, 'README.md'), '# user edits\n');
		const { harness_dir } = harness(cwd);
		review(harness_dir, worktree, [], true);
		writeFileSync(join(worktree, 'README.md'), '# task edits\n');
		review(harness_dir, worktree, ['README.md'], false);
		expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe(
			'# user edits\n',
		);
	});

	it('keeps nested workspace paths relative to the execution cwd', () => {
		const root = project();
		const cwd = join(root, 'src');
		writeFileSync(join(cwd, 'index.ts'), 'export const value = 2;\n');
		const { harness_dir } = harness(cwd, ['index.ts']);
		review(harness_dir, cwd, [], true);
		writeFileSync(join(cwd, 'index.ts'), 'export const value = 3;\n');
		review(harness_dir, cwd, ['index.ts'], true);
	});

	it('does not exempt filenames in legacy contracts without file-state snapshots', () => {
		const cwd = project();
		writeFileSync(join(cwd, 'README.md'), '# user edits\n');
		const { harness_dir, contract } = harness(cwd);
		delete contract.policy.baseline_file_states;
		writeFileSync(
			join(harness_dir, 'harness.json'),
			JSON.stringify(contract),
		);
		review(harness_dir, cwd, ['README.md'], false);
	});

	it('fails rather than claiming clean when the captured repository becomes unavailable', () => {
		const cwd = project();
		const { harness_dir } = harness(cwd);
		renameSync(join(cwd, '.git'), join(temp_dir(), 'saved-git'));
		const result = spawnSync(
			'bash',
			[join(harness_dir, 'review.sh')],
			{ cwd, stdio: 'ignore' },
		);
		expect(result.status).not.toBe(0);
		expect(() => collect_harness_outcome(harness_dir, cwd)).toThrow();
	});

	it('detects executable-bit and symlink-target changes', () => {
		const cwd = project();
		writeFileSync(join(cwd, 'run.sh'), '#!/bin/sh\n');
		chmodSync(join(cwd, 'run.sh'), 0o644);
		symlinkSync('README.md', join(cwd, 'current'));
		const { harness_dir } = harness(cwd);
		review(harness_dir, cwd, [], true);
		chmodSync(join(cwd, 'run.sh'), 0o755);
		rmSync(join(cwd, 'current'));
		symlinkSync('src/index.ts', join(cwd, 'current'));
		review(harness_dir, cwd, ['current', 'run.sh'], false);
	});
});
