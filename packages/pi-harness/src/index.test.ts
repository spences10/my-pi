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
	HARNESS_ASSESSMENT_CUSTOM_TYPE,
	HARNESS_CUSTOM_TYPE,
	HARNESS_SYSTEM_PROMPT,
	active_harness_context,
	amend_harness_runtime,
	assessment_active,
	assessment_tool_names,
	check_assessment_command,
	check_command_allowed,
	check_path_allowed,
	create_assessment_state,
	create_harness_runtime,
	format_assessment_record,
	format_harness_status_line,
	should_inject_harness_prompt,
	submit_assessment_record,
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
				escalation_rules: ['Stop if the source contract changes'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);

		expect(harness_dir).toContain('my-pi-harness-harness-tests');
		expect(contract.scaffold.task).toBe('Add harness tests');
		expect(contract.scaffold.allowed_paths).toEqual(['src/**']);
		expect(contract.scaffold.version).toBe(1);
		expect(contract.scaffold.escalation_rules).toEqual([
			'Stop if the source contract changes',
		]);
		expect(contract.policy.cwd).toBe(cwd);
		expect(
			readFileSync(join(harness_dir, 'SYSTEM.md'), 'utf8'),
		).toContain('Outer policy');
		expect(
			readFileSync(join(harness_dir, 'TASK.md'), 'utf8'),
		).toContain('Approved-contract recovery');
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

	it('keeps terminal runs sealed for the remainder of the current turn', () => {
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Complete guarded work' },
			cwd,
		);
		cleanup_paths.push(harness_dir);
		update_harness_runtime({ harness_dir, status: 'completed' });

		const context = active_harness_context(harness_dir);
		expect(context).toContain('This run is sealed');
		expect(context).toContain('cannot escape policy');
		expect(context).toContain(
			'next direct user turn or session startup',
		);
		expect(context).toContain(
			'Do not create another harness merely to commit or push',
		);
	});
});

describe('harness assessment helpers', () => {
	it('creates versioned assessment state and requires an evidence-backed contract', () => {
		const state = create_assessment_state(
			'Consider a plugin system',
			'user',
			['read', 'bash', 'edit', 'team'],
			new Date('2026-08-27T00:00:00.000Z'),
		);
		expect(assessment_active(state)).toBe(true);
		expect(state.id).toMatch(/^assessment-/);
		expect(() =>
			submit_assessment_record(state, {
				task: state.task,
				evidence: ['The repository has one implementation'],
				existing_primitives: [],
				rejected_options: [],
				smallest_vertical_slice: 'Test one manual path',
				recommendation: 'harness',
				proposed_contract: { task: state.task },
			}),
		).toThrow('explicit allowed paths');

		const submitted = submit_assessment_record(state, {
			task: state.task,
			evidence: ['The repository has one implementation'],
			existing_primitives: ['Existing extension hook'],
			rejected_options: ['New planner: no observed need'],
			smallest_vertical_slice: 'Test one manual path',
			recommendation: 'harness',
			proposed_contract: {
				task: state.task,
				allowed_paths: ['src/**'],
				validation_commands: ['pnpm test'],
			},
		});
		expect(submitted).toMatchObject({
			version: 2,
			status: 'awaiting_approval',
		});
		expect(format_assessment_record(submitted)).toContain(
			'Existing extension hook',
		);
		expect(format_assessment_record(submitted)).toContain(
			'Allowed paths: src/**',
		);
		expect(format_assessment_record(submitted)).toContain(
			'Validation: pnpm test',
		);
	});

	it('keeps only explicit read-only tools during assessment', () => {
		expect(
			assessment_tool_names([
				'read',
				'bash',
				'edit',
				'write',
				'team',
				'lsp_hover',
				'mcp__mcp-omnisearch__web_search',
			]),
		).toEqual([
			'read',
			'bash',
			'lsp_hover',
			'mcp__mcp-omnisearch__web_search',
			'harness_assess',
			'harness_assessment_submit',
			'harness_read',
		]);
	});

	it('allows focused inspection commands and blocks shell composition or mutation', () => {
		expect(check_assessment_command('git status --short')).toEqual({
			ok: true,
		});
		expect(check_assessment_command('gh issue view 524')).toEqual({
			ok: true,
		});
		expect(
			check_assessment_command("rg -n 'plugin|registry' ."),
		).toEqual({ ok: true });
		expect(
			check_assessment_command('rg plugin . | tee result'),
		).toMatchObject({
			ok: false,
		});
		expect(
			check_assessment_command('git status && rm -rf .'),
		).toMatchObject({
			ok: false,
		});
		expect(check_assessment_command('find . -delete')).toMatchObject({
			ok: false,
		});
		expect(
			check_assessment_command('git branch speculative'),
		).toMatchObject({
			ok: false,
		});
		expect(
			check_assessment_command('git remote add origin x'),
		).toMatchObject({
			ok: false,
		});
		expect(
			check_assessment_command('gh api repos/a/b/issues -f title=x'),
		).toMatchObject({ ok: false });
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
	it('defines positive harness selection criteria', () => {
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'benefits from an enforceable execution contract',
		);
		for (const selection_criterion of [
			'material risk',
			'unresolved scope',
			'destructive effects',
			'complex coordination',
		]) {
			expect(HARNESS_SYSTEM_PROMPT).toContain(selection_criterion);
		}
	});

	it('routes routine low-risk changes to direct work', () => {
		for (const direct_work of [
			'documentation or copy edits',
			'focused single-file fixes',
			'configuration or metadata updates',
			'test expectation changes',
			'formatting',
		]) {
			expect(HARNESS_SYSTEM_PROMPT).toContain(direct_work);
		}
	});

	it('keeps Factory outside normal harness execution', () => {
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'Harness approval does not authorize Factory',
		);
	});

	it('routes reviewed commit and push follow-ups to direct work', () => {
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'reviewed commit or push follow-ups',
		);
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'automatically deactivates on the next direct user turn or session startup',
		);
	});

	it('names work that can justify a harness', () => {
		const prompt = HARNESS_SYSTEM_PROMPT.toLowerCase();
		for (const justified_work of [
			'broad uncertain refactor',
			'destructive effects',
			'migration',
			'deployment',
			'risky release',
			'external side effect',
			'explicit user request',
		]) {
			expect(prompt).toContain(justified_work);
		}
	});

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
	function extension_harness() {
		const commands = new Map<string, { handler: Function }>();
		const tools = new Map<
			string,
			{
				name: string;
				execute: Function;
				constrainedSampling?: unknown;
			}
		>();
		const handlers = new Map<string, Function>();
		const send_user_message = vi.fn();
		const send_message = vi.fn();
		const append_entry = vi.fn();
		let active_tools = [
			'read',
			'bash',
			'edit',
			'write',
			'team',
			'harness_assess',
			'harness_assessment_submit',
			'harness_create',
			'harness_read',
		];
		const set_active_tools = vi.fn((names: string[]) => {
			active_tools = names;
		});
		const api = {
			appendEntry: append_entry,
			getActiveTools: () => active_tools,
			on: (name: string, handler: Function) => {
				handlers.set(name, handler);
			},
			registerCommand: (
				name: string,
				definition: { handler: Function },
			) => {
				commands.set(name, definition);
			},
			registerTool: (definition: {
				name: string;
				execute: Function;
				constrainedSampling?: unknown;
			}) => {
				tools.set(definition.name, definition);
			},
			sendMessage: send_message,
			sendUserMessage: send_user_message,
			setActiveTools: set_active_tools,
		} as unknown as ExtensionAPI;
		return {
			active_tools: () => active_tools,
			api,
			append_entry,
			commands,
			handlers,
			send_message,
			send_user_message,
			set_active_tools,
			tools,
		};
	}

	function extension_context(cwd: string, select = vi.fn()) {
		return {
			cwd,
			hasUI: true,
			sessionManager: {
				getBranch: (): unknown[] => [],
				getEntries: (): unknown[] => [],
			},
			ui: {
				notify: vi.fn(),
				select,
				setStatus: vi.fn(),
				setWidget: vi.fn(),
			},
		};
	}

	it('routes harness creation into enforced assessment', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const ctx = extension_context(temp_project());

		expect(fixture.commands.has('assess')).toBe(true);
		expect(fixture.commands.has('harness')).toBe(true);
		expect(fixture.tools.has('harness_assess')).toBe(true);
		expect(fixture.tools.has('harness_assessment_submit')).toBe(true);
		expect(fixture.tools.has('harness_create')).toBe(true);
		expect(fixture.handlers.has('agent_end')).toBe(true);
		expect(fixture.handlers.has('tool_call')).toBe(true);

		await fixture.commands
			.get('harness')!
			.handler('create add plugin architecture', ctx);
		expect(fixture.send_user_message).toHaveBeenCalledWith(
			expect.stringContaining(
				'Assess this task before creating a harness',
			),
		);
		expect(fixture.active_tools()).toContain('read');
		expect(fixture.active_tools()).toContain(
			'harness_assessment_submit',
		);
		expect(fixture.active_tools()).not.toContain('edit');
		expect(fixture.active_tools()).not.toContain('team');
		expect(fixture.append_entry).toHaveBeenCalledWith(
			HARNESS_ASSESSMENT_CUSTOM_TYPE,
			expect.objectContaining({
				status: 'assessing',
				task: 'add plugin architecture',
			}),
		);

		await expect(
			fixture.handlers.get('tool_call')?.(
				{ toolName: 'edit', input: { path: 'src/index.ts' } },
				ctx,
			),
		).resolves.toMatchObject({ block: true });
		await expect(
			fixture.handlers.get('tool_call')?.(
				{
					toolName: 'bash',
					input: { command: 'git status --short' },
				},
				ctx,
			),
		).resolves.toBeUndefined();
		await expect(
			fixture.handlers.get('tool_call')?.(
				{ toolName: 'bash', input: { command: 'touch new-file' } },
				ctx,
			),
		).resolves.toMatchObject({ block: true });
	});

	it('blocks an unapproved harness_create call and starts assessment', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const ctx = extension_context(temp_project());

		await expect(
			fixture.handlers.get('tool_call')?.(
				{
					toolName: 'harness_create',
					input: { task: 'Replace the persistence layer' },
				},
				ctx,
			),
		).resolves.toMatchObject({
			block: true,
			reason: expect.stringContaining('requires direct approval'),
		});
		expect(fixture.active_tools()).not.toContain('write');
	});

	it('creates the exact approved harness and restores tools', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const cwd = temp_project();
		const select = vi
			.fn()
			.mockResolvedValue('Create and execute harness');
		const ctx = extension_context(cwd, select);

		await fixture.commands
			.get('assess')!
			.handler('Add a bounded adapter', ctx);
		await fixture.tools.get('harness_assessment_submit')!.execute(
			'assessment-call',
			{
				task: 'Add a bounded adapter',
				evidence: ['src/adapter.ts is the current boundary'],
				existing_primitives: ['Existing adapter interface'],
				rejected_options: ['New task graph: no observed need'],
				smallest_vertical_slice: 'Implement one adapter path',
				recommendation: 'harness',
				proposed_contract: {
					task: 'Implement one adapter path',
					allowed_paths: ['src/adapter.ts'],
					validation_commands: ['pnpm test'],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		await fixture.handlers.get('agent_end')?.({}, ctx);

		expect(select).toHaveBeenCalledOnce();
		expect(fixture.active_tools()).toContain('edit');
		expect(fixture.append_entry).toHaveBeenCalledWith(
			HARNESS_ASSESSMENT_CUSTOM_TYPE,
			expect.objectContaining({
				status: 'approved',
				decision: 'harness',
			}),
		);
		const active_entry = fixture.append_entry.mock.calls
			.filter(([type]) => type === HARNESS_CUSTOM_TYPE)
			.at(-1)?.[1] as { active_harness_dir?: string };
		expect(active_entry.active_harness_dir).toContain(
			'my-pi-harness-implement-one-adapter-path',
		);
		cleanup_paths.push(active_entry.active_harness_dir!);
		const contract = JSON.parse(
			readFileSync(
				join(active_entry.active_harness_dir!, 'harness.json'),
				'utf8',
			),
		);
		expect(contract.scaffold.allowed_paths).toEqual([
			'src/adapter.ts',
		]);
		expect(contract.scaffold.validation_commands).toEqual([
			'pnpm test',
		]);
		expect(fixture.send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.stringContaining('Execute harness'),
			}),
			expect.objectContaining({ triggerTurn: true }),
		);
		expect(fixture.send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.stringContaining('execute-harness skill'),
			}),
			expect.objectContaining({ triggerTurn: true }),
		);
		expect(fixture.send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.stringContaining(
					'does not authorize Factory',
				),
			}),
			expect.objectContaining({ triggerTurn: true }),
		);
	});

	it('amends an active harness only after assessment approval', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{
				task: 'Initial capability',
				allowed_paths: ['src/base.ts'],
				validation_commands: ['pnpm test'],
			},
			cwd,
		);
		cleanup_paths.push(harness_dir);
		const select = vi
			.fn()
			.mockResolvedValue('Approve and amend active harness');
		const ctx = extension_context(cwd, select);
		await fixture.commands
			.get('harness')!
			.handler(`use ${harness_dir}`, ctx);
		await fixture.commands
			.get('assess')!
			.handler('Adopt one evidenced capability', ctx);
		await fixture.tools.get('harness_assessment_submit')!.execute(
			'assessment-call',
			{
				task: 'Adopt one evidenced capability',
				evidence: ['The existing boundary supports one extension'],
				existing_primitives: ['Existing extension boundary'],
				rejected_options: ['New framework: no need'],
				smallest_vertical_slice: 'Add one extension',
				recommendation: 'harness',
				proposed_contract: {
					task: 'Add one approved extension',
					allowed_paths: ['src/base.ts', 'src/extension.ts'],
					validation_commands: ['pnpm test', 'pnpm run check'],
				},
			},
			undefined,
			undefined,
			ctx,
		);
		await fixture.handlers.get('agent_end')?.({}, ctx);

		const amended = JSON.parse(
			readFileSync(join(harness_dir, 'harness.json'), 'utf8'),
		);
		expect(amended.scaffold.version).toBe(2);
		expect(amended.scaffold.allowed_paths).toEqual([
			'src/base.ts',
			'src/extension.ts',
		]);
		expect(amended.amendments.at(-1).reason).toContain(
			'Approved assessment',
		);
		expect(fixture.send_message).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.stringContaining('approved scaffold v2'),
			}),
			expect.objectContaining({ triggerTurn: true }),
		);
	});

	it('keeps headless assessment awaiting direct approval', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const ctx = {
			...extension_context(temp_project()),
			hasUI: false,
		};
		await fixture.commands
			.get('assess')!
			.handler('Review a risky change', ctx);
		await fixture.tools.get('harness_assessment_submit')!.execute(
			'assessment-call',
			{
				task: 'Review a risky change',
				evidence: ['Risk exists'],
				existing_primitives: [],
				rejected_options: [],
				smallest_vertical_slice: 'No implementation yet',
				recommendation: 'reject',
			},
			undefined,
			undefined,
			ctx,
		);
		await fixture.handlers.get('agent_end')?.({}, ctx);
		expect(ctx.ui.select).not.toHaveBeenCalled();
		expect(fixture.active_tools()).not.toContain('edit');
		expect(fixture.append_entry).toHaveBeenLastCalledWith(
			HARNESS_ASSESSMENT_CUSTOM_TYPE,
			expect.objectContaining({ status: 'awaiting_approval' }),
		);
	});

	it('restores terminal harness and active assessment state on session start', async () => {
		const fixture = extension_harness();
		await harness(fixture.api);
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Completed work' },
			cwd,
		);
		cleanup_paths.push(harness_dir);
		update_harness_runtime({ harness_dir, status: 'completed' });
		const assessment = create_assessment_state(
			'Assess resumed work',
			'user',
			fixture.active_tools(),
		);
		const ctx = extension_context(cwd);
		const entries = [
			{
				type: 'custom',
				customType: HARNESS_CUSTOM_TYPE,
				data: { active_harness_dir: harness_dir },
			},
			{
				type: 'custom',
				customType: HARNESS_ASSESSMENT_CUSTOM_TYPE,
				data: assessment,
			},
		];
		ctx.sessionManager.getBranch = () => entries;
		ctx.sessionManager.getEntries = () => entries;
		await fixture.handlers.get('session_start')?.({}, ctx);
		expect(fixture.append_entry).toHaveBeenCalledWith(
			HARNESS_CUSTOM_TYPE,
			{ active_harness_dir: undefined },
		);
		expect(fixture.active_tools()).not.toContain('edit');
		await expect(
			fixture.handlers.get('before_agent_start')?.({
				systemPrompt: 'base',
				systemPromptOptions: {},
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Active harness assessment',
			),
		});
	});
});
