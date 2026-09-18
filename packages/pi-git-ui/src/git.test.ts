import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vite-plus/test';
import {
	build_line_patch,
	changed_line_indexes,
	commit as commit_changes,
	discard_file,
	git_path,
	has_staged_changes,
	parse_diff_hunks,
	parse_porcelain_z,
	staged_file_count,
} from './git.js';

const exec_file = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec_file('git', args, {
		cwd,
		encoding: 'utf8',
	});
	return stdout;
}

async function git_with_input(
	cwd: string,
	args: string[],
	input: string,
): Promise<string> {
	return await new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, stdio: 'pipe' });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else
				reject(new Error(stderr || `git exited with status ${code}`));
		});
		child.stdin.end(input);
	});
}

async function with_repo(
	run: (cwd: string) => Promise<void>,
): Promise<void> {
	const cwd = await mkdtemp(join(tmpdir(), 'pi-git-ui-test-'));
	try {
		await git(cwd, ['init']);
		await git(cwd, ['config', 'user.email', 'test@example.com']);
		await git(cwd, ['config', 'user.name', 'Test User']);
		await run(cwd);
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
}

describe('parse_porcelain_z', () => {
	it('classifies and sorts git status entries', () => {
		const files = parse_porcelain_z(
			[
				' M src/changed.ts',
				'?? notes.md',
				'MM src/mixed.ts',
				'A  src/staged.ts',
				'UU src/conflict.ts',
			].join('\0') + '\0',
		);

		expect(files.map((file) => [file.path, file.state])).toEqual([
			['src/conflict.ts', 'conflicted'],
			['src/changed.ts', 'changed'],
			['notes.md', 'untracked'],
			['src/mixed.ts', 'mixed'],
			['src/staged.ts', 'staged'],
		]);
	});

	it('keeps rename source and target visible while targeting the new path for git commands', () => {
		const files = parse_porcelain_z(
			['R  new.ts', 'old.ts'].join('\0') + '\0',
		);

		expect(files).toHaveLength(1);
		expect(files[0]?.path).toBe('old.ts → new.ts');
		expect(files[0]?.state).toBe('staged');
		expect(git_path(files[0]!)).toBe('new.ts');
	});

	it('classifies copy, delete, and unmerged porcelain states', () => {
		const files = parse_porcelain_z(
			[
				'C  copied.ts',
				'original.ts',
				' D deleted.ts',
				'D  staged-delete.ts',
				'AA both-added.ts',
				'DD both-deleted.ts',
			].join('\0') + '\0',
		);

		expect(files.map((file) => [file.path, file.state])).toEqual([
			['both-added.ts', 'conflicted'],
			['both-deleted.ts', 'conflicted'],
			['deleted.ts', 'changed'],
			['original.ts → copied.ts', 'staged'],
			['staged-delete.ts', 'staged'],
		]);
	});

	it('counts only index changes as staged changes', () => {
		const files = parse_porcelain_z(
			[
				' M changed.ts',
				'?? new.ts',
				'A  staged.ts',
				'MM mixed.ts',
			].join('\0') + '\0',
		);

		expect(has_staged_changes(files)).toBe(true);
		expect(staged_file_count(files)).toBe(2);
		expect(
			has_staged_changes(parse_porcelain_z(' M only.ts\0')),
		).toBe(false);
	});
});

describe('parse_diff_hunks', () => {
	const diff = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const one = 1;
+const two = 2;
 const three = 3;
@@ -10,3 +11,4 @@ function run() {
 	start();
+	finish();
 }
`;

	it('extracts independently applicable hunk patches', () => {
		const hunks = parse_diff_hunks(diff, 'unstaged');

		expect(hunks).toHaveLength(2);
		expect(hunks[0]).toMatchObject({
			section: 'unstaged',
			line_index: 4,
			header: '@@ -1,3 +1,4 @@',
		});
		expect(hunks[0]?.patch).toContain(
			'diff --git a/src/app.ts b/src/app.ts',
		);
		expect(hunks[0]?.patch).toContain('+const two = 2;');
		expect(hunks[0]?.patch).not.toContain('+\tfinish();');
		expect(hunks[1]?.patch).toContain('+\tfinish();');
	});

	it('builds a minimal patch for one selected added line', () => {
		const hunk = parse_diff_hunks(diff, 'unstaged')[0]!;
		const line_index = changed_line_indexes(hunk)[0]!;
		const patch = build_line_patch(hunk, line_index);

		expect(patch).toContain('@@ -1,2 +1,3 @@');
		expect(patch).toContain('+const two = 2;');
		expect(patch).toContain(' const one = 1;');
		expect(patch).toContain(' const three = 3;');
	});

	it('builds a minimal patch for one selected deleted line', () => {
		const deletion = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,3 @@
 const one = 1;
-const two = 2;
 const three = 3;
 const four = 4;
`;
		const hunk = parse_diff_hunks(deletion, 'unstaged')[0]!;
		const line_index = changed_line_indexes(hunk)[0]!;
		const patch = build_line_patch(hunk, line_index);

		expect(patch).toContain('@@ -1,4 +1,3 @@');
		expect(patch).toContain('-const two = 2;');
		expect(patch).toContain(' const one = 1;');
		expect(patch).toContain(' const three = 3;');
	});

	it('drops unselected additions while keeping unselected deletions as context', () => {
		const replacement = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 const one = 1;
 const two = 2;
-old three
+new three
+new four
 const five = 5;
`;
		const hunk = parse_diff_hunks(replacement, 'unstaged')[0]!;
		const line_indexes = changed_line_indexes(hunk);
		const patch = build_line_patch(hunk, line_indexes[0]!);

		expect(patch).toContain('-old three');
		expect(patch).not.toContain('+new three');
		expect(patch).not.toContain('+new four');
		expect(patch).toContain(' const two = 2;');
	});

	it('rejects attempts to build a line patch for context lines', () => {
		const hunk = parse_diff_hunks(diff, 'unstaged')[0]!;

		expect(() => build_line_patch(hunk, hunk.line_index + 1)).toThrow(
			'Selected line is not stageable.',
		);
	});

	it('builds line patches that git can apply to the index', async () => {
		await with_repo(async (cwd) => {
			await writeFile(
				join(cwd, 'app.ts'),
				['const one = 1;', 'const three = 3;', ''].join('\n'),
			);
			await git(cwd, ['add', 'app.ts']);
			await git(cwd, ['commit', '-m', 'initial']);
			await writeFile(
				join(cwd, 'app.ts'),
				[
					'const one = 1;',
					'const two = 2;',
					'const three = 3;',
					'const four = 4;',
					'',
				].join('\n'),
			);
			const raw = await git(cwd, ['diff', '--', 'app.ts']);
			const hunk = parse_diff_hunks(raw, 'unstaged')[0]!;
			const [first_line] = changed_line_indexes(hunk);
			const patch = build_line_patch(hunk, first_line!);

			await git_with_input(
				cwd,
				['apply', '--cached', '--check', '--whitespace=nowarn', '-'],
				`${patch}\n`,
			);
			await git_with_input(
				cwd,
				['apply', '--cached', '--whitespace=nowarn', '-'],
				`${patch}\n`,
			);

			const staged = await git(cwd, [
				'diff',
				'--cached',
				'--',
				'app.ts',
			]);
			expect(staged).toContain('+const two = 2;');
			expect(staged).not.toContain('+const four = 4;');
		});
	});
});

describe('git operations', () => {
	it('discards unstaged tracked file changes without touching staged changes', async () => {
		await with_repo(async (cwd) => {
			await writeFile(join(cwd, 'app.ts'), 'one\n');
			await git(cwd, ['add', 'app.ts']);
			await git(cwd, ['commit', '-m', 'initial']);
			await writeFile(join(cwd, 'app.ts'), 'two\n');
			await git(cwd, ['add', 'app.ts']);
			await writeFile(join(cwd, 'app.ts'), 'three\n');
			const [file] = parse_porcelain_z(
				await git(cwd, ['status', '--porcelain=v1', '-z']),
			);

			await discard_file(cwd, file!);

			expect(await git(cwd, ['diff', '--', 'app.ts'])).toBe('');
			expect(
				await git(cwd, ['diff', '--cached', '--', 'app.ts']),
			).toContain('+two');
		});
	});

	it('removes untracked files when discarding them', async () => {
		await with_repo(async (cwd) => {
			await writeFile(join(cwd, 'scratch.ts'), 'temporary\n');
			const [file] = parse_porcelain_z(
				await git(cwd, ['status', '--porcelain=v1', '-z']),
			);

			await discard_file(cwd, file!);

			expect(await git(cwd, ['status', '--porcelain=v1', '-z'])).toBe(
				'',
			);
		});
	});

	it('can amend HEAD with staged changes', async () => {
		await with_repo(async (cwd) => {
			await writeFile(join(cwd, 'app.ts'), 'one\n');
			await git(cwd, ['add', 'app.ts']);
			await git(cwd, ['commit', '-m', 'initial']);
			const before = await git(cwd, ['rev-list', '--count', 'HEAD']);
			await writeFile(join(cwd, 'app.ts'), 'two\n');
			await git(cwd, ['add', 'app.ts']);

			await commit_changes(cwd, 'amended', { amend: true });

			expect(await git(cwd, ['rev-list', '--count', 'HEAD'])).toBe(
				before,
			);
			expect(await git(cwd, ['log', '-1', '--pretty=%s'])).toBe(
				'amended\n',
			);
			expect(
				await git(cwd, ['show', '--pretty=', '--name-only', 'HEAD']),
			).toContain('app.ts');
		});
	});
});
