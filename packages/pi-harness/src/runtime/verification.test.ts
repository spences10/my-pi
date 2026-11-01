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
	check_command_allowed,
	check_path_allowed,
} from '../enforcement/policy.js';
import { read_contract, read_status } from './files.js';
import {
	amend_harness_runtime,
	create_harness_runtime,
	update_harness_runtime,
} from './index.js';

const cleanup: string[] = [];
afterEach(() => {
	for (const dir of cleanup.splice(0).reverse())
		rmSync(dir, { recursive: true, force: true });
});
async function run(command: string, cwd: string) {
	const result = spawnSync('bash', ['-lc', command], {
		cwd,
		encoding: 'utf8',
	});
	return {
		passed: result.status === 0,
		output: result.stdout + result.stderr,
	};
}
function fixture(commands = ['printf checked']) {
	const cwd = mkdtempSync(join(tmpdir(), 'pi-harness-verification-'));
	cleanup.push(cwd);
	execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
	mkdirSync(join(cwd, 'src'));
	writeFileSync(
		join(cwd, 'src/index.ts'),
		'export const value = 1;\n',
	);
	const { harness_dir, contract } = create_harness_runtime(
		{
			task: 'Verified work',
			validation_commands: commands,
			allowed_paths: ['src/**'],
		},
		cwd,
	);
	cleanup.push(harness_dir);
	return { cwd, harness_dir, contract };
}

describe('accepted checks and scope', () => {
	it('requires real acceptance commands at creation', () => {
		const { cwd } = fixture();
		expect(() =>
			create_harness_runtime(
				{ task: 'No checks', validation_commands: [] },
				cwd,
			),
		).toThrow('accepted validation');
	});
	it('allows tests, deep globs, and ordinary git flags without blanket command bans', () => {
		const { contract, harness_dir, cwd } = fixture();
		const amended = amend_harness_runtime({
			harness_dir,
			reason: 'Focus implementation',
			allowed_paths: ['src/**/*.ts'],
		});
		mkdirSync(join(cwd, 'src/a/b'), { recursive: true });
		writeFileSync(join(cwd, 'src/a/b/value.test.ts'), 'export {};\n');
		expect(
			check_path_allowed(amended, 'src/a/b/value.test.ts'),
		).toEqual({ ok: true });
		expect(
			spawnSync('node', [join(harness_dir, 'guard.mjs')], { cwd })
				.status,
		).toBe(0);
		expect(
			check_command_allowed(contract, 'git status -u all'),
		).toEqual({ ok: true });
	});
	it('cannot remove accepted checks, relax explicit test protection, or grant a wider scope', () => {
		const { harness_dir, contract, cwd } = fixture();
		expect(() =>
			amend_harness_runtime({
				harness_dir,
				reason: 'Skip checks',
				validation_commands: ['true'],
			}),
		).toThrow('accepted validation');
		const widened = amend_harness_runtime({
			harness_dir,
			reason: 'Try a wider strategy',
			allowed_paths: ['.'],
		});
		expect(widened.policy.allowed_paths).toEqual(
			contract.policy.allowed_paths,
		);
		expect(check_path_allowed(widened, 'README.md')).toMatchObject({
			ok: false,
		});
		writeFileSync(join(cwd, 'README.md'), 'outside accepted scope\n');
		expect(
			spawnSync('node', [join(harness_dir, 'guard.mjs')], {
				cwd,
				stdio: 'ignore',
			}).status,
		).toBe(1);
		const protected_run = create_harness_runtime(
			{
				task: 'Protected tests',
				validation_commands: ['true'],
				allow_test_changes: false,
			},
			cwd,
		);
		cleanup.push(protected_run.harness_dir);
		expect(() =>
			amend_harness_runtime({
				harness_dir: protected_run.harness_dir,
				reason: 'Unlock tests',
				allow_test_changes: true,
			}),
		).toThrow('accepted test restriction');
	});
});

describe('completion verification', () => {
	it('validates the linked execution worktree rather than the parent checkout', async () => {
		const { cwd, harness_dir } = fixture(['true']);
		execFileSync('git', ['-C', cwd, 'add', '.']);
		execFileSync(
			'git',
			[
				'-C',
				cwd,
				'-c',
				'user.email=test@example.com',
				'-c',
				'user.name=Test',
				'-c',
				'commit.gpgsign=false',
				'-c',
				'core.hooksPath=/dev/null',
				'commit',
				'-m',
				'initial',
			],
			{ stdio: 'ignore' },
		);
		const worktree = mkdtempSync(
			join(tmpdir(), 'pi-harness-linked-'),
		);
		cleanup.push(worktree);
		execFileSync(
			'git',
			['-C', cwd, 'worktree', 'add', '-b', 'executor', worktree],
			{ stdio: 'ignore' },
		);
		writeFileSync(
			join(cwd, 'outside.txt'),
			'parent change is not executor work\n',
		);
		writeFileSync(
			join(worktree, 'src/index.ts'),
			'export const value = 2;\n',
		);
		await update_harness_runtime(
			{ harness_dir, status: 'completed' },
			{ run, cwd: worktree },
		);
		const outcome = JSON.parse(
			readFileSync(join(harness_dir, 'outcome.json'), 'utf8'),
		);
		expect(outcome.execution_cwd).toBe(worktree);
		expect(outcome.changed_files).toEqual(['src/index.ts']);
		expect(
			outcome.validation.checks.every(
				(check: { passed: boolean }) => check.passed,
			),
		).toBe(true);
	});
	it('rejects a foreign repository and bounds persisted validation output', async () => {
		const { harness_dir } = fixture(['true']);
		const other = fixture(['true']);
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{ run, cwd: other.cwd },
			),
		).rejects.toThrow('accepted repository');
		const status = await update_harness_runtime(
			{ harness_dir, status: 'completed' },
			{
				run: async (command, cwd) => {
					const result = await run(command, cwd);
					return { ...result, output: 'x'.repeat(1024 * 1024 + 100) };
				},
			},
		);
		expect(
			readFileSync(status.log.at(-1)!.checks![0].output_file).length,
		).toBe(1024 * 1024);
	});

	it('runs accepted checks and drift review before recording completion, with bounded output references', async () => {
		const { harness_dir } = fixture();
		const status = await update_harness_runtime(
			{ harness_dir, status: 'completed' },
			{ run },
		);
		expect(status.status).toBe('completed');
		const checks = status.log.at(-1)!.checks!;
		expect(checks).toHaveLength(2);
		expect(checks.every((check) => check.passed)).toBe(true);
		expect(readFileSync(checks[0].output_file, 'utf8')).toBe(
			'checked',
		);
		await expect(
			update_harness_runtime({ harness_dir, status: 'running' }),
		).rejects.toThrow('sealed');
		expect(() =>
			amend_harness_runtime({
				harness_dir,
				reason: 'Change completed work',
				allowed_paths: ['.'],
			}),
		).toThrow('completed');
	});
	it('cannot manufacture success from a note or a legacy contract', async () => {
		const { harness_dir } = fixture();
		await expect(
			update_harness_runtime({
				harness_dir,
				status: 'completed',
				evidence: 'All tests passed',
			}),
		).rejects.toThrow('execution backend');
		expect(read_status(harness_dir).status).toBe('failed');
		const legacy = read_contract(harness_dir);
		delete legacy.policy.validation_commands;
		writeFileSync(
			join(harness_dir, 'harness.json'),
			JSON.stringify(legacy),
		);
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{ run },
			),
		).rejects.toThrow('Recreate');
	});
	it('records failed checks and permits ordinary fix-and-retry loops', async () => {
		const { harness_dir, cwd } = fixture(['test -f src/ready']);
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(
				update_harness_runtime(
					{ harness_dir, status: 'completed' },
					{ run },
				),
			).rejects.toThrow('Validation failed');
		}
		writeFileSync(join(cwd, 'src/ready'), 'ready\n');
		expect(
			(
				await update_harness_runtime(
					{ harness_dir, status: 'completed' },
					{ run },
				)
			).status,
		).toBe('completed');
		expect(
			read_status(harness_dir).log.filter(
				(entry) => entry.status === 'failed',
			),
		).toHaveLength(2);
	});
	it('rejects failed drift checks even when acceptance commands pass', async () => {
		const { harness_dir, cwd } = fixture(['true']);
		writeFileSync(join(cwd, 'outside.txt'), 'outside scope\n');
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{ run },
			),
		).rejects.toThrow('Validation failed');
		expect(
			read_status(harness_dir).log.at(-1)!.checks!.at(-1)!.passed,
		).toBe(false);
	});
	it('rejects artifacts changed by validation until the final state is rechecked', async () => {
		const { harness_dir } = fixture([
			'printf changed > src/index.ts',
		]);
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{ run },
			),
		).rejects.toThrow('workspace changed');
		expect(
			(
				await update_harness_runtime(
					{ harness_dir, status: 'completed' },
					{ run },
				)
			).status,
		).toBe('completed');
	});
	it('never turns cancellation or execution errors into success', async () => {
		const { harness_dir } = fixture();
		const controller = new AbortController();
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{
					signal: controller.signal,
					run: async () => {
						controller.abort();
						return { passed: true, output: 'interrupted' };
					},
				},
			),
		).rejects.toThrow('interrupted');
		expect(read_status(harness_dir).status).toBe('failed');
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{
					run: async () => {
						throw new Error('Backend failed');
					},
				},
			),
		).rejects.toThrow('Backend failed');
	});
	it('rejects changing the accepted contract while validation is running', async () => {
		const { harness_dir } = fixture(['true']);
		let changed = false;
		await expect(
			update_harness_runtime(
				{ harness_dir, status: 'completed' },
				{
					run: async (command, cwd) => {
						if (!changed) {
							changed = true;
							const modified = read_contract(harness_dir);
							modified.scaffold.task = 'Different task';
							writeFileSync(
								join(harness_dir, 'harness.json'),
								JSON.stringify(modified),
							);
						}
						return run(command, cwd);
					},
				},
			),
		).rejects.toThrow('Contract or workspace changed');
	});
	it('blocks concurrent API amendments and status mutations during validation', async () => {
		const { harness_dir } = fixture(['true']);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const completion = update_harness_runtime(
			{ harness_dir, status: 'completed' },
			{
				run: async (command, cwd) => {
					await gate;
					return run(command, cwd);
				},
			},
		);
		expect(() =>
			amend_harness_runtime({
				harness_dir: join(harness_dir, '.'),
				reason: 'Race',
				allowed_paths: ['.'],
			}),
		).toThrow('validating');
		await expect(
			update_harness_runtime({ harness_dir, status: 'running' }),
		).rejects.toThrow('already running');
		release();
		await completion;
	});
});
