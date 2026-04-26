import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import confirm_destructive, {
	assess_bash_command,
	assess_tool_call,
} from './index.js';

function create_test_pi() {
	const events = new Map<string, any>();
	const pi = {
		on(name: string, handler: any) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, events };
}

function create_context(overrides: Partial<any> = {}) {
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

function git(cwd: string, args: string[]) {
	execFileSync('git', ['-C', cwd, ...args], {
		stdio: ['ignore', 'ignore', 'ignore'],
	});
}

function create_git_repo(): string {
	const cwd = tmp_dir();
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
});

describe('assess_tool_call', () => {
	it('detects overwriting an untracked existing file with write', () => {
		const cwd = tmp_dir();
		writeFileSync(join(cwd, 'important.md'), 'keep me');

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'important.md', content: 'replace me' },
			} as any,
			cwd,
		);

		expect(action?.reason).toBe(
			'Overwrites an untracked file git cannot restore',
		);
	});

	it('allows overwriting a clean tracked file because git can restore it', () => {
		const cwd = create_git_repo();

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'tracked.md', content: 'replace me' },
			} as any,
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
			} as any,
			cwd,
		);

		expect(action?.reason).toBe(
			'Overwrites a file with uncommitted changes',
		);
	});

	it('allows writing a new file', () => {
		const cwd = tmp_dir();

		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'write',
				input: { path: 'new.md', content: 'hello' },
			} as any,
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
			} as any,
			cwd,
		);

		expect(action).toBeUndefined();
	});

	it('detects large content removal from untracked files', () => {
		const cwd = tmp_dir();
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
			} as any,
			cwd,
		);

		expect(action?.reason).toBe(
			'Removes substantial content from a file git cannot fully restore',
		);
	});

	it('detects destructive custom tool names', () => {
		const action = assess_tool_call(
			{
				type: 'tool_call',
				toolCallId: 'tool-1',
				toolName: 'mcp__sqlite__execute_write_query',
				input: { query: 'delete from users' },
			} as any,
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

		const handler = events.get('tool_call');
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

		const handler = events.get('tool_call');
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

		const handler = events.get('tool_call');
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

		const handler = events.get('tool_call');
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

		const handler = events.get('tool_call');
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

	it('blocks destructive user bash commands when declined', async () => {
		const cwd = create_git_repo();
		writeFileSync(join(cwd, 'untracked.md'), 'important');
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('user_bash');
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
