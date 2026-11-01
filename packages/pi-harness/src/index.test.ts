import { execFileSync, spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	HARNESS_SYSTEM_PROMPT,
	active_harness_context,
	amend_harness_runtime,
	assessment_active,
	check_command_allowed,
	check_path_allowed,
	create_assessment_state,
	create_harness_runtime as create_runtime,
	format_assessment_record,
	format_harness_status_line,
	should_inject_harness_prompt,
	submit_assessment_record,
	update_harness_runtime,
} from './index.js';

const cleanup_paths: string[] = [];

function create_harness_runtime(
	params: Omit<
		Parameters<typeof create_runtime>[0],
		'validation_commands'
	> & { validation_commands?: string[] },
	cwd: string,
) {
	return create_runtime(
		{
			...params,
			validation_commands: params.validation_commands ?? ['true'],
		},
		cwd,
	);
}

async function run_check(command: string, cwd: string) {
	const result = spawnSync('bash', ['-lc', command], {
		cwd,
		encoding: 'utf8',
	});
	return {
		passed: result.status === 0,
		output: result.stdout + result.stderr,
	};
}

function temp_project(): string {
	const path = mkdtempSync(
		join(tmpdir(), 'pi-harness-test-project-'),
	);
	cleanup_paths.push(path);
	execFileSync('git', ['-C', path, 'init'], { stdio: 'ignore' });
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

	it('updates status and appends notes without treating them as executed checks', async () => {
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Update status' },
			cwd,
		);
		cleanup_paths.push(harness_dir);

		const status_file = await update_harness_runtime({
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

	it('keeps completed runs sealed for the remainder of the current turn', async () => {
		const cwd = temp_project();
		const { harness_dir } = create_harness_runtime(
			{ task: 'Complete guarded work' },
			cwd,
		);
		cleanup_paths.push(harness_dir);
		await update_harness_runtime(
			{ harness_dir, status: 'completed' },
			{ run: run_check },
		);

		const context = active_harness_context(harness_dir);
		expect(context).toContain('This run is sealed');
		expect(context).toContain('API rejects amendments');
		expect(context).toContain(
			'next direct user turn or session startup',
		);
		expect(context).toContain(
			'Do not create another harness merely to commit or push',
		);
	});
});

describe('optional assessment', () => {
	it('records advice without introducing an approval gate', () => {
		const state = create_assessment_state(
			'Investigate adapters',
			'user',
		);
		expect(assessment_active(state)).toBe(true);
		const submitted = submit_assessment_record(state, {
			task: state.task,
			evidence: ['Existing adapter'],
			existing_primitives: ['Pi tools'],
			rejected_options: ['New scheduler'],
			smallest_vertical_slice: 'One adapter',
			recommendation: 'direct',
		});
		expect(submitted.status).toBe('assessed');
		expect(assessment_active(submitted)).toBe(false);
		expect(format_assessment_record(submitted)).toContain('Pi tools');
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

	it('blocks edits outside scope and honors explicit test restrictions', () => {
		const cwd = temp_project();
		const { contract, harness_dir } = create_harness_runtime(
			{
				task: 'Blocked path',
				allowed_paths: ['src/**'],
				allow_test_changes: false,
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
			{
				task: 'Blocked command',
				forbidden_commands: ['git reset --hard'],
			},
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

describe('harness guidance', () => {
	it('keeps assessment optional, normal tests and retries available, and peer coordination honest', () => {
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'does not restrict tools',
		);
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'Normal coding and test development are allowed',
		);
		expect(HARNESS_SYSTEM_PROMPT).toContain(
			'without an arbitrary one-attempt limit',
		);
		expect(HARNESS_SYSTEM_PROMPT).not.toContain('Factory');
	});
	it('injects only for normal coding loadouts', () => {
		expect(
			should_inject_harness_prompt({
				systemPromptOptions: { selectedTools: ['bash'] },
			} as Parameters<typeof should_inject_harness_prompt>[0]),
		).toBe(true);
		expect(
			should_inject_harness_prompt({
				systemPromptOptions: { selectedTools: ['read'] },
			} as Parameters<typeof should_inject_harness_prompt>[0]),
		).toBe(false);
	});
});
