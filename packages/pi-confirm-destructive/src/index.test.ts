import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import confirm_destructive, {
	assess_bash_command,
	assess_tool_call,
} from './index.js';

function create_test_pi() {
	const events = new Map<string, Function>();
	const pi = {
		on(name: string, handler: Function) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, events };
}

function create_context(overrides: Partial<ExtensionContext> = {}) {
	const notify = vi.fn();
	const select = vi.fn();

	const ctx = {
		hasUI: true,
		cwd: process.cwd(),
		ui: {
			notify,
			select,
		},
		...overrides,
	};

	return { ctx, notify, select };
}

const dirs: string[] = [];

function tmp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-guard-'));
	dirs.push(dir);
	return dir;
}

function work_dir(): string {
	const dir = mkdtempSync(
		join(process.cwd(), '.pi-confirm-destructive-test-'),
	);
	dirs.push(dir);
	return dir;
}

function git(cwd: string, args: string[]) {
	execFileSync('git', ['-C', cwd, ...args], {
		stdio: ['ignore', 'ignore', 'ignore'],
	});
}

function create_git_repo(cwd = work_dir()): string {
	git(cwd, ['init']);
	git(cwd, ['config', 'user.email', 'test@example.com']);
	git(cwd, ['config', 'user.name', 'Test User']);
	writeFileSync(join(cwd, 'tracked.md'), 'tracked');
	git(cwd, ['add', 'tracked.md']);
	git(cwd, ['commit', '-m', 'initial']);
	return cwd;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('assess_bash_command', () => {
	it.each([
		'pnpx prisma migrate reset',
		'prisma db push --force-reset',
		'psql "$DATABASE_URL" -c "drop table users"',
		'sqlite3 app.db "delete from users"',
		'find . -name "*.tmp" -delete',
		'git clean -fdx',
		'git clean --force -d',
		'git -C . clean -fdx',
		'rsync -a --delete src/ dest/',
		'truncate -s 0 app.log',
	])('detects broadly destructive command: %s', (command) => {
		expect(assess_bash_command(command)).toBeTruthy();
	});

	it.each(['ls -la', 'pnpm test', 'git status', 'rg TODO src'])(
		'allows non-destructive command: %s',
		(command) => {
			expect(assess_bash_command(command)).toBeUndefined();
		},
	);

	it('allows deleting a clean tracked file because git can restore it', () => {
		const cwd = create_git_repo();

		expect(assess_bash_command('rm tracked.md', cwd)).toBeUndefined();
		expect(
			assess_bash_command('git rm tracked.md', cwd),
		).toBeUndefined();
	});

	it('detects deleting untracked files because git cannot restore them', () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');

		expect(assess_bash_command('rm untracked.md', cwd)?.reason).toBe(
			'Deletes untracked files or directories that git cannot restore',
		);
	});

	it('allows deleting files created during the current session', () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'draft.md'), 'temporary');

		expect(
			assess_bash_command(
				'rm draft.md',
				cwd,
				new Set([join(cwd, 'draft.md')]),
			),
		).toBeUndefined();
	});

	it('allows deleting my-pi temp workspaces', () => {
		const path = join(tmpdir(), 'my-pi-audit-check');

		expect(
			assess_bash_command(`rm -rf ${path}`, process.cwd()),
		).toBeUndefined();
	});

	it('allows deleting a specific literal temp directory', () => {
		const path = join(tmpdir(), 'customer-export');

		expect(
			assess_bash_command(`rm -rf ${path}`, process.cwd()),
		).toBeUndefined();
	});

	it.each([
		() => `rm -rf ${tmpdir()}`,
		() => `rm -rf ${join(tmpdir(), '*')}`,
		() => 'rm -rf $TMPDIR/customer-export',
		() => `rm -rf ${tmpdir()}/build/../customer-export`,
	])(
		'still detects an unbounded or ambiguous temp deletion',
		(command) => {
			expect(
				assess_bash_command(command(), process.cwd()),
			).toBeTruthy();
		},
	);

	it('still detects relative and tilde-expanded paths from a temp cwd', () => {
		const cwd = tmp_dir();
		writeFileSync(join(cwd, 'scratch.md'), 'temporary');

		expect(assess_bash_command('rm scratch.md', cwd)).toBeTruthy();
		expect(
			assess_bash_command('rm -rf ~/Documents', cwd),
		).toBeTruthy();
	});

	it('still detects a command with both temp and non-temp targets', () => {
		const outside = join(work_dir(), 'important');
		expect(
			assess_bash_command(
				`rm -rf ${join(tmpdir(), 'build')} ${outside}`,
				process.cwd(),
			),
		).toBeTruthy();
	});

	it.skipIf(process.platform === 'win32')(
		'still detects a temp symlink that resolves outside the temp root',
		() => {
			const outside = work_dir();
			const temp = tmp_dir();
			const link = join(temp, 'outside-link');
			symlinkSync(outside, link, 'dir');

			expect(
				assess_bash_command(`rm -rf ${link}`, process.cwd()),
			).toBeTruthy();
		},
	);

	it('preserves Git protection for explicit temp targets', () => {
		const cwd = create_git_repo(tmp_dir());
		const tracked = join(cwd, 'tracked.md');
		writeFileSync(tracked, 'changed');

		expect(
			assess_bash_command(`rm -rf ${cwd}`, process.cwd()),
		).toBeTruthy();
		expect(
			assess_bash_command(
				`rm -rf ${join(cwd, '.git')}`,
				process.cwd(),
			),
		).toBeTruthy();
		expect(
			assess_bash_command(`rm ${tracked}`, process.cwd()),
		).toBeTruthy();
	});

	it('detects deleting tracked files with uncommitted changes', () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'tracked.md'), 'changed');

		expect(assess_bash_command('rm tracked.md', cwd)?.reason).toBe(
			'Deletes files with uncommitted changes',
		);
	});

	it('detects hard reset only when there are changes to discard', () => {
		const cwd = create_git_repo();
		expect(
			assess_bash_command('git reset --hard HEAD', cwd),
		).toBeUndefined();

		writeFileSync(join(cwd, 'tracked.md'), 'changed');
		expect(
			assess_bash_command('git reset --hard HEAD', cwd)?.reason,
		).toBe('Discards uncommitted tracked changes');
	});

	it.each([
		'git push --force',
		'git push -f origin main',
		'git push --force-with-lease',
		'git push --force-if-includes',
	])('detects force push command: %s', (command) => {
		expect(assess_bash_command(command)?.reason).toBe(
			'Overwrites remote git history',
		);
	});

	it.each([
		'echo ready\nrm -rf untracked.md',
		'echo x | xargs rm -rf untracked.md',
		"sh -c 'rm -rf untracked.md'",
		'(rm -rf untracked.md)',
		'{ rm -rf untracked.md; }',
		'env rm -rf untracked.md',
		'command rm -rf untracked.md',
		'find . -execdir rm -rf untracked.md \\;',
		"find . -execdir sh -c 'rm -rf untracked.md' \\;",
		"echo x | xargs sh -c 'rm -rf untracked.md'",
		'echo "$(rm -rf untracked.md)"',
		'echo `rm -rf untracked.md`',
		"eval 'rm -rf untracked.md'",
		"sudo --user root env FLAG=1 bash -lc 'rm -rf untracked.md'",
		'nice -n 5 rm -rf untracked.md',
		'ionice -c 3 rm -rf untracked.md',
		'stdbuf -o L rm -rf untracked.md',
		'setsid rm -rf untracked.md',
		'busybox rm -rf untracked.md',
	])('detects wrapped or compound removal: %s', (command) => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');
		expect(assess_bash_command(command, cwd)).toBeTruthy();
	});

	it('does not confuse quoted destructive-looking text with command intent', () => {
		expect(
			assess_bash_command("printf '%s\\n' 'rm -rf important.md'"),
		).toBeUndefined();
	});

	it('does not treat heredoc bodies as executable command intent', () => {
		const command = [
			"cat > guide.md <<'EOF'",
			'rm -rf is dangerous documentation',
			'EOF',
		].join('\n');
		expect(assess_bash_command(command)).toBeUndefined();
	});

	it('still detects destructive commands following a heredoc', () => {
		const command = [
			"cat > guide.md <<'EOF'",
			'rm -rf is dangerous documentation',
			'EOF',
			'rm -rf untracked.md',
		].join('\n');
		expect(assess_bash_command(command)).toBeTruthy();
	});

	it('preserves safe git and redirect operations', () => {
		const cwd = create_git_repo();
		expect(
			assess_bash_command('git branch -d merged', cwd),
		).toBeUndefined();
		expect(
			assess_bash_command('echo replacement > tracked.md', cwd),
		).toBeUndefined();
		expect(
			assess_bash_command('echo ok > /dev/null', cwd),
		).toBeUndefined();
		expect(
			assess_bash_command('find . -exec printf "%s\\n" {} \\;', cwd),
		).toBeUndefined();
	});

	it('allows overwriting an explicit absolute temp path by redirection', () => {
		const cwd = tmp_dir();
		const path = join(cwd, 'build.log');
		writeFileSync(path, 'old output');

		expect(
			assess_bash_command(`echo replacement > ${path}`, cwd),
		).toBeUndefined();
		expect(
			assess_bash_command('echo replacement > build.log', cwd),
		).toBeTruthy();
		expect(
			assess_bash_command('echo replacement > ~/.bashrc', cwd),
		).toBeTruthy();
	});

	it('treats the repository root as unrecoverable', () => {
		const cwd = create_git_repo();
		expect(assess_bash_command('rm -rf .', cwd)).toBeTruthy();
	});

	it('treats ignored files beneath a tracked directory as unrecoverable', () => {
		const cwd = create_git_repo();
		mkdirSync(join(cwd, 'src'));
		writeFileSync(join(cwd, 'src', 'tracked.ts'), 'tracked');
		writeFileSync(join(cwd, '.gitignore'), 'src/.env\n');
		git(cwd, ['add', 'src/tracked.ts', '.gitignore']);
		git(cwd, ['commit', '-m', 'add src']);
		writeFileSync(join(cwd, 'src', '.env'), 'important');

		expect(assess_bash_command('rm -rf src', cwd)).toBeTruthy();
	});

	it.each([
		'> untracked.log',
		': > untracked.log',
		"sed -i 's/old/new/' untracked.log",
		"sed --in-place 's/old/new/' untracked.log",
		'git stash drop',
		'git branch -D old-branch',
		'git branch --delete --force old-branch',
		'git push origin --delete old-branch',
		'git push -d origin old-branch',
		'git push origin :old-branch',
		'docker system prune -af',
		'dropdb production',
		'redis-cli flushall',
		'terraform destroy -auto-approve',
		'aws s3 rm s3://bucket --recursive',
		'kubectl delete namespace production',
	])('detects destructive command family: %s', (command) => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.log'), 'important');
		expect(assess_bash_command(command, cwd)).toBeTruthy();
	});
});

describe('assess_tool_call', () => {
	it('detects overwriting an untracked existing file with write', () => {
		const cwd = work_dir();
		writeFileSync(join(cwd, 'important.md'), 'keep me');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'important.md', content: 'replace me' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action?.reason).toBe(
			'Overwrites an untracked file git cannot restore',
		);
	});

	it('allows overwriting files created during the current session', () => {
		const cwd = work_dir();
		writeFileSync(join(cwd, 'draft.md'), 'first draft');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'draft.md', content: 'second draft' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
			new Set([join(cwd, 'draft.md')]),
		);

		expect(action).toBeUndefined();
	});

	it('allows overwriting an explicit absolute temp file', () => {
		const cwd = tmp_dir();
		const path = join(cwd, 'scratch.md');
		writeFileSync(path, 'first draft');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path, content: 'second draft' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('still detects a relative overwrite inside a temp cwd', () => {
		const cwd = tmp_dir();
		writeFileSync(join(cwd, 'scratch.md'), 'first draft');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'scratch.md', content: 'second draft' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeTruthy();
	});

	it('allows overwriting a descendant of a session-created directory', () => {
		const cwd = work_dir();
		const created = join(cwd, 'generated');
		mkdirSync(created);
		writeFileSync(join(created, 'result.md'), 'first draft');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: {
					path: 'generated/result.md',
					content: 'second draft',
				},
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
			new Set([created]),
		);

		expect(action).toBeUndefined();
	});

	it.skipIf(process.platform === 'win32')(
		'still detects a temp write through a symlink outside the temp root',
		() => {
			const outside = work_dir();
			const outside_file = join(outside, 'important.md');
			writeFileSync(outside_file, 'keep me');
			const temp = tmp_dir();
			const link = join(temp, 'important.md');
			symlinkSync(outside_file, link);

			const action = assess_tool_call(
				{
					type: 'tool_call',
					toolCallId: 'tool-1',
					toolName: 'write',
					input: { path: link, content: 'replace me' },
				} satisfies Parameters<typeof assess_tool_call>[0],
				process.cwd(),
			);

			expect(action).toBeTruthy();
		},
	);

	it('allows overwriting a clean tracked file because git can restore it', () => {
		const cwd = create_git_repo();

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'tracked.md', content: 'replace me' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('detects overwriting a tracked file with uncommitted changes', () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'tracked.md'), 'changed');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'tracked.md', content: 'replace me' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action?.reason).toBe(
			'Overwrites a file with uncommitted changes',
		);
	});

	it('preserves dirty tracked-file protection for temp writes', () => {
		const cwd = create_git_repo(tmp_dir());
		const path = join(cwd, 'tracked.md');
		writeFileSync(path, 'changed');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path, content: 'replace me' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			process.cwd(),
		);

		expect(action).toBeTruthy();
	});

	it('allows writing a new file', () => {
		const cwd = tmp_dir();

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'new.md', content: 'hello' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('allows large content removal from clean tracked files', () => {
		const cwd = create_git_repo();

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'edit',
				input: {
					path: 'tracked.md',
					edits: [{ oldText: 'x'.repeat(250), newText: '' }],
				},
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('detects large content removal from untracked files', () => {
		const cwd = work_dir();
		writeFileSync(join(cwd, 'important.md'), 'x'.repeat(300));

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'edit',
				input: {
					path: 'important.md',
					edits: [{ oldText: 'x'.repeat(250), newText: '' }],
				},
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action?.reason).toBe(
			'Removes substantial content from a file git cannot fully restore',
		);
	});

	it('allows large content removal from an explicit absolute temp file', () => {
		const cwd = tmp_dir();
		const path = join(cwd, 'scratch.md');
		writeFileSync(path, 'x'.repeat(300));

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'edit',
				input: {
					path,
					edits: [{ oldText: 'x'.repeat(250), newText: '' }],
				},
			} satisfies Parameters<typeof assess_tool_call>[0],
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('detects destructive custom tool names', () => {
		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'mcp__sqlite__execute_write_query',
				input: { query: 'delete from users' },
			} satisfies Parameters<typeof assess_tool_call>[0],
			process.cwd(),
		);

		expect(action?.reason).toContain('execute_write_query');
	});
});

describe('confirm-destructive extension', () => {
	it('blocks destructive tool calls when the action is blocked', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('tool_call')!;
		const { ctx, select, notify } = create_context({ cwd });
		select.mockResolvedValue('Block');

		const result = await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'bash',
				input: { command: 'rm untracked.md' },
			},
			ctx,
		);

		expect(select).toHaveBeenCalledWith(
			expect.stringContaining('rm untracked.md'),
			['Allow once', 'Allow similar for this session', 'Block'],
		);
		expect(notify).toHaveBeenCalledWith(
			'Destructive action blocked',
			'info',
		);
		expect(result).toEqual({
			block: true,
			reason:
				'Blocked destructive action: Deletes untracked files or directories that git cannot restore',
		});
	});

	it('allows destructive tool calls once when selected', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('tool_call')!;
		const { ctx, select, notify } = create_context({ cwd });
		select.mockResolvedValue('Allow once');

		const result = await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'bash',
				input: { command: 'rm untracked.md' },
			},
			ctx,
		);

		expect(select).toHaveBeenCalledOnce();
		expect(notify).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('allows similar destructive actions for the session', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'one.md'), 'important');
		writeFileSync(join(cwd, 'two.md'), 'important');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('tool_call')!;
		const { ctx, select } = create_context({ cwd });
		select.mockResolvedValue('Allow similar for this session');

		await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'bash',
				input: { command: 'rm one.md' },
			},
			ctx,
		);
		const second = await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-2',
				toolName: 'bash',
				input: { command: 'rm two.md' },
			},
			ctx,
		);

		expect(select).toHaveBeenCalledOnce();
		expect(second).toBeUndefined();
	});

	it('blocks destructive tool calls without UI', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'tracked.md'), 'changed');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('tool_call')!;
		const { ctx, select } = create_context({ hasUI: false, cwd });

		const result = await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'bash',
				input: { command: 'git reset --hard HEAD' },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toEqual({
			block: true,
			reason:
				'Blocked destructive action: Discards uncommitted tracked changes',
		});
	});

	it('does not prompt for non-destructive tool calls', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('tool_call')!;
		const { ctx, select } = create_context();

		const result = await handler(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'bash',
				input: { command: 'pnpm test' },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('does not prompt when deleting a file created by the agent', async () => {
		const cwd = work_dir();
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const tool_call = events.get('tool_call')!;
		const tool_result = events.get('tool_result')!;
		const { ctx, select } = create_context({ cwd });

		await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'write-1',
				toolName: 'write',
				input: { path: 'draft.md', content: 'temporary' },
			},
			ctx,
		);
		writeFileSync(join(cwd, 'draft.md'), 'temporary');
		await tool_result({
			type: 'tool_result',
			toolCallId: 'write-1',
			toolName: 'write',
			isError: false,
			result: undefined,
		});

		const result = await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-1',
				toolName: 'bash',
				input: { command: 'rm draft.md' },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('does not prompt when deleting a temp directory created by bash', async () => {
		const cwd = tmp_dir();
		const path = join(tmpdir(), 'pi-created-by-bash');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const tool_call = events.get('tool_call')!;
		const tool_result = events.get('tool_result')!;
		const { ctx, select } = create_context({ cwd });

		dirs.push(path);
		rmSync(path, { recursive: true, force: true });
		await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-create-1',
				toolName: 'bash',
				input: { command: `mkdir -p ${path}` },
			},
			ctx,
		);
		mkdirSync(path, { recursive: true });
		writeFileSync(join(path, 'artifact.txt'), 'temporary');
		await tool_result({
			type: 'tool_result',
			toolCallId: 'bash-create-1',
			toolName: 'bash',
			isError: false,
			content: [],
		});

		const result = await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-rm-1',
				toolName: 'bash',
				input: { command: `rm -rf ${path}` },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('does not prompt when deleting a temp path returned by mktemp', async () => {
		const cwd = tmp_dir();
		const path = join(tmpdir(), 'pi-mktemp-output');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const tool_call = events.get('tool_call')!;
		const tool_result = events.get('tool_result')!;
		const { ctx, select } = create_context({ cwd });

		dirs.push(path);
		rmSync(path, { recursive: true, force: true });
		await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-mktemp-1',
				toolName: 'bash',
				input: { command: 'mktemp' },
			},
			ctx,
		);
		writeFileSync(path, 'temporary');
		await tool_result({
			type: 'tool_result',
			toolCallId: 'bash-mktemp-1',
			toolName: 'bash',
			isError: false,
			content: [{ type: 'text', text: `${path}\n` }],
		});

		const result = await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-rm-1',
				toolName: 'bash',
				input: { command: `rm ${path}` },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('does not prompt when deleting a temp file created by bash redirection', async () => {
		const cwd = tmp_dir();
		const path = join(tmpdir(), 'pi-created-by-redirection');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const tool_call = events.get('tool_call')!;
		const tool_result = events.get('tool_result')!;
		const { ctx, select } = create_context({ cwd });

		dirs.push(path);
		rmSync(path, { recursive: true, force: true });
		await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-redirect-1',
				toolName: 'bash',
				input: { command: `printf temporary > ${path}` },
			},
			ctx,
		);
		writeFileSync(path, 'temporary');
		await tool_result({
			type: 'tool_result',
			toolCallId: 'bash-redirect-1',
			toolName: 'bash',
			isError: false,
			content: [],
		});

		const result = await tool_call(
			{
				type: 'tool_call',
				toolCallId: 'bash-rm-1',
				toolName: 'bash',
				input: { command: `rm ${path}` },
			},
			ctx,
		);

		expect(select).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('blocks destructive user bash commands when declined', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('user_bash')!;
		const { ctx, select } = create_context({ cwd });
		select.mockResolvedValue('Block');

		const result = await handler(
			{
				type: 'user_bash',
				command: 'rm untracked.md',
				excludeFromContext: false,
				cwd,
			},
			ctx,
		);

		expect(result).toEqual({
			result: {
				output:
					'Blocked destructive action: Deletes untracked files or directories that git cannot restore\n',
				exitCode: 130,
				cancelled: false,
				truncated: false,
			},
		});
	});
});
