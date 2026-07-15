import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import harness, {
	HARNESS_SYSTEM_PROMPT,
	amend_harness_runtime,
	check_command_allowed,
	check_path_allowed,
	create_harness_runtime,
	format_harness_status_line,
	should_inject_harness_prompt,
	update_harness_runtime,
} from './index.js';

const cleanup_paths: string[] = [];

function temp_project(): string {
	const path = mkdtempSync(
		join(tmpdir(), 'pi-harness-test-project-'),
	);
	cleanup_paths.push(path);
	return path;
}

afterEach(() => {
	for (const path of cleanup_paths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe('create_harness_runtime', () => {
	it('creates a /tmp runtime with contract, prompts, scripts, and status', () => {
		const cwd = temp_project();
		const { harness_dir, contract } = create_harness_runtime(
			{
				task: 'Add harness tests',
				slug: 'harness-tests',
				allowed_paths: ['src/**'],
				validation_commands: ['pnpm test'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(harness_dir).toContain('my-pi-harness-harness-tests');
		expect(contract.scaffold.task).toBe('Add harness tests');
		expect(contract.scaffold.allowed_paths).toEqual(['src/**']);
		expect(contract.scaffold.version).toBe(1);
		expect(contract.policy.cwd).toBe(cwd);
		expect(
			readFileSync(join(harness_dir, 'SYSTEM.md'), 'utf8'),
		).toContain('Outer policy');
		expect(
			readFileSync(join(harness_dir, 'TASK.md'), 'utf8'),
		).toContain('Context recovery');
		expect(
			readFileSync(join(harness_dir, 'validate.sh'), 'utf8'),
		).toContain('pnpm test');
		expect(
			readFileSync(join(harness_dir, 'guard.mjs'), 'utf8'),
		).toContain('Harness guard passed');
		expect(
			readFileSync(join(harness_dir, 'review.sh'), 'utf8'),
		).toContain('outcome.mjs');
		expect(
			readFileSync(join(harness_dir, 'outcome.mjs'), 'utf8'),
		).toContain('OUTCOME.md');
		expect(
			readFileSync(join(harness_dir, 'status.json'), 'utf8'),
		).toContain('created');
		expect(
			readFileSync(join(harness_dir, 'OUTCOME.md'), 'utf8'),
		).toContain('Harness outcome');
		expect(
			readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
		).toContain('changed_files');
	});

	it('amends only the inner scaffold and records version history', () => {
		const cwd = temp_project();
		const { harness_dir, contract: original } =
			create_harness_runtime(
				{ task: 'Initial task', forbidden_paths: ['.git/**'] },
				cwd,
			);
		cleanup_paths.push(harness_dir);
		const amended = amend_harness_runtime({
			harness_dir,
			reason: 'User requested test coverage',
			requested_by: 'user',
			allowed_paths: ['src/**', 'tests/**'],
			allow_test_changes: true,
		});
		expect(amended.scaffold.version).toBe(2);
		expect(amended.scaffold.allow_test_changes).toBe(true);
		expect(amended.policy).toEqual(original.policy);
		expect(amended.amendments.at(-1)).toMatchObject({
			requested_by: 'user',
			from_version: 1,
			to_version: 2,
			changes: ['allowed_paths', 'allow_test_changes'],
		});
		expect(
			readFileSync(join(harness_dir, 'SYSTEM.md'), 'utf8'),
		).toContain('Inner scaffold v2');
		expect(
			readFileSync(join(harness_dir, 'status.json'), 'utf8'),
		).toContain('User requested test coverage');
	});

	it('rejects an empty scaffold amendment', () => {
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Task' },
			cwd,
		);
		cleanup_paths.push(harness_dir);
		expect(() =>
			amend_harness_runtime({
				harness_dir,
				reason: 'No actual change',
			}),
		).toThrow('no scaffold changes');
	});

	it('updates status and appends evidence', () => {
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Update status' },
			cwd,
		);
		cleanup_paths.push(harness_dir);

		const status_file = update_harness_runtime({
			harness_dir,
			status: 'running',
			phase: 'validation',
			evidence: 'tests passed',
			team_status: 'executor completed task #1',
			remaining_risks: ['manual review pending'],
			changed_files: ['src/index.ts'],
		});

		expect(status_file.status).toBe('running');
		expect(status_file.phase).toBe('validation');
		expect(format_harness_status_line(harness_dir)).toBe(
			'🧪 running (validation)',
		);
		expect(status_file.log.at(-1)?.evidence).toBe('tests passed');
		expect(status_file.log.at(-1)?.team_status).toBe(
			'executor completed task #1',
		);
		const outcome = JSON.parse(
			readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
		);
		expect(outcome.changed_files).toContain('src/index.ts');
		expect(outcome.validation.evidence.at(-1).evidence).toBe(
			'tests passed',
		);
		expect(outcome.team_status).toBe('executor completed task #1');
		expect(outcome.remaining_risks).toEqual([
			'manual review pending',
		]);
		expect(
			readFileSync(join(harness_dir, 'OUTCOME.md'), 'utf8'),
		).toContain('manual review pending');
	});
});

describe('harness enforcement helpers', () => {
	it('allows edits inside relative and absolute allowed paths', () => {
		const cwd = temp_project();
		const { contract, harness_dir } = create_harness_runtime(
			{
				task: 'Allowed path',
				allowed_paths: ['src/**', join(cwd, 'docs/**')],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(check_path_allowed(contract, 'src/index.ts')).toEqual({
			ok: true,
		});
		expect(check_path_allowed(contract, 'docs/guide.md')).toEqual({
			ok: true,
		});
	});

	it('blocks edits outside allowed paths and test edits by default', () => {
		const cwd = temp_project();
		const { contract, harness_dir } = create_harness_runtime(
			{
				task: 'Blocked path',
				allowed_paths: ['src/**'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(check_path_allowed(contract, 'README.md')).toMatchObject({
			ok: false,
		});
		expect(
			check_path_allowed(contract, 'src/index.test.ts'),
		).toMatchObject({
			ok: false,
		});
	});

	it('blocks forbidden commands', () => {
		const cwd = temp_project();
		const { contract, harness_dir } = create_harness_runtime(
			{ task: 'Blocked command' },
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(
			check_command_allowed(contract, 'git reset --hard'),
		).toMatchObject({ ok: false });
	});

	it('generates a guard that accepts allowed drift and rejects out-of-contract drift', () => {
		const cwd = temp_project();
		execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
		const { harness_dir } = create_harness_runtime(
			{
				task: 'Guard drift',
				allowed_paths: [join(cwd, 'src/**')],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		mkdirSync(join(cwd, 'src'), { recursive: true });
		writeFileSync(join(cwd, 'src/index.ts'), 'export {};\n');
		expect(() =>
			execFileSync('node', [join(harness_dir, 'guard.mjs')]),
		).not.toThrow();
		expect(() =>
			execFileSync('bash', [join(harness_dir, 'review.sh')]),
		).not.toThrow();
		expect(
			JSON.parse(
				readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
			).changed_files,
		).toContain('src/index.ts');

		writeFileSync(join(cwd, 'README.md'), '# outside\n');
		expect(() =>
			execFileSync('node', [join(harness_dir, 'guard.mjs')], {
				stdio: 'ignore',
			}),
		).toThrow();
	});

	it('ignores dirty baseline files that existed before harness creation', () => {
		const cwd = temp_project();
		mkdirSync(join(cwd, 'src'), { recursive: true });
		writeFileSync(join(cwd, 'src/index.ts'), 'export {};\n');
		writeFileSync(join(cwd, 'README.md'), '# baseline\n');
		execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
		execFileSync('git', ['-C', cwd, 'config', 'user.email', 'a@b.c']);
		execFileSync('git', ['-C', cwd, 'config', 'user.name', 'A']);
		execFileSync('git', ['-C', cwd, 'add', '.']);
		execFileSync('git', ['-C', cwd, 'commit', '-m', 'init'], {
			stdio: 'ignore',
		});
		writeFileSync(join(cwd, 'README.md'), '# pre-existing dirty\n');

		const { harness_dir } = create_harness_runtime(
			{
				task: 'Dirty baseline',
				allowed_paths: ['src/**'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(() =>
			execFileSync('node', [join(harness_dir, 'guard.mjs')]),
		).not.toThrow();
		const outcome = JSON.parse(
			readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
		);
		expect(outcome.baseline_changed_files).toContain('README.md');
		expect(outcome.changed_files).not.toContain('README.md');
	});

	it('reviews and reports changes from a linked worktree execution cwd', () => {
		const cwd = temp_project();
		const worktree = temp_project();
		mkdirSync(join(cwd, 'src'), { recursive: true });
		writeFileSync(join(cwd, 'src/index.ts'), 'export const x = 1;\n');
		execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
		execFileSync('git', ['-C', cwd, 'config', 'user.email', 'a@b.c']);
		execFileSync('git', ['-C', cwd, 'config', 'user.name', 'A']);
		execFileSync('git', ['-C', cwd, 'add', '.']);
		execFileSync('git', ['-C', cwd, 'commit', '-m', 'init'], {
			stdio: 'ignore',
		});
		rmSync(worktree, { recursive: true, force: true });
		execFileSync(
			'git',
			['-C', cwd, 'worktree', 'add', '-b', 'task', worktree],
			{
				stdio: 'ignore',
			},
		);
		cleanup_paths.push(worktree);
		const { harness_dir } = create_harness_runtime(
			{
				task: 'Worktree execution',
				allowed_paths: ['src/**'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		writeFileSync(
			join(worktree, 'src/index.ts'),
			'export const x = 2;\n',
		);
		expect(() =>
			execFileSync('bash', [join(harness_dir, 'review.sh')], {
				cwd: worktree,
			}),
		).not.toThrow();
		const outcome = JSON.parse(
			readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
		);
		expect(outcome.execution_cwd).toBe(worktree);
		expect(outcome.changed_files).toContain('src/index.ts');
	});
});

describe('should_inject_harness_prompt', () => {
	it('injects when selected tools are unavailable or bash is active', () => {
		expect(
			should_inject_harness_prompt({
				systemPromptOptions: {},
			} as Parameters<typeof should_inject_harness_prompt>[0]),
		).toBe(true);
		expect(
			should_inject_harness_prompt({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as Parameters<typeof should_inject_harness_prompt>[0]),
		).toBe(true);
	});

	it('skips when bash is unavailable', () => {
		expect(
			should_inject_harness_prompt({
				systemPromptOptions: { selectedTools: ['read'] },
			} as Parameters<typeof should_inject_harness_prompt>[0]),
		).toBe(false);
	});
});

describe('harness extension', () => {
	it('registers commands, tools, and lifecycle hooks', async () => {
		const commands = new Map<string, { handler: Function }>();
		const tools = new Map<
			string,
			{ name: string; execute: Function }
		>();
		const handlers = new Map<string, Function>();
		const register_command = vi.fn(
			(name: string, definition: { handler: Function }) => {
				commands.set(name, definition);
			},
		);
		const register_tool = vi.fn(
			(definition: { name: string; execute: Function }) => {
				tools.set(definition.name, definition);
			},
		);
		const on = vi.fn((name: string, handler: Function) => {
			handlers.set(name, handler);
		});
		const send_user_message = vi.fn();

		await harness({
			appendEntry: vi.fn(),
			on,
			registerCommand: register_command,
			registerTool: register_tool,
			sendUserMessage: send_user_message,
		} as unknown as ExtensionAPI);

		expect(commands.has('harness')).toBe(true);
		expect(tools.has('harness_create')).toBe(true);
		expect(tools.has('harness_update')).toBe(true);
		expect(tools.has('harness_read')).toBe(true);
		expect(handlers.has('before_agent_start')).toBe(true);
		expect(handlers.has('tool_call')).toBe(true);

		commands.get('harness')!.handler('create add feature', {
			ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
		});
		expect(send_user_message).toHaveBeenCalledWith(
			expect.stringContaining('Use the create-harness skill'),
		);
		expect(send_user_message).toHaveBeenCalledWith(
			expect.stringContaining('add a team task'),
		);

		commands.get('harness')!.handler('run /tmp/my-pi-harness-demo', {
			ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
		});
		expect(send_user_message).toHaveBeenCalledWith(
			expect.stringContaining(
				'one mutating teammate only when useful',
			),
		);

		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{
				task: 'This deliberately long task must not appear in the persistent widget',
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);
		const ui = {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		};
		commands.get('harness')!.handler(`use ${harness_dir}`, { ui });
		expect(ui.setStatus).toHaveBeenCalledWith(
			'harness',
			'🧪 created',
		);
		expect(ui.setWidget).toHaveBeenCalledWith('harness', undefined);
		commands.get('harness')!.handler('clear', { ui });

		await expect(
			handlers.get('before_agent_start')?.({
				systemPrompt: 'base',
				systemPromptOptions: {},
			}),
		).resolves.toEqual({
			systemPrompt: `base\n\n${HARNESS_SYSTEM_PROMPT}`,
		});
	});
});
