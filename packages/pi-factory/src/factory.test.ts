import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { load_factory_contract, start_factory } from './factory.js';
import type { ProcessRunner } from './types.js';

function make_harness(
	validation_commands = ['check', 'test'],
	cwd = '/workspace',
	baseline_changed_files: string[] = [],
) {
	const harness_dir = mkdtempSync(join(tmpdir(), 'factory-test-'));
	writeFileSync(
		join(harness_dir, 'harness.json'),
		JSON.stringify({
			version: 2,
			id: 'test-harness',
			policy: {
				cwd,
				baseline_changed_files,
				forbidden_paths: [],
				forbidden_commands: [],
			},
			scaffold: {
				task: 'Fix widget',
				allowed_paths: ['src/**'],
				validation_commands,
				allow_test_changes: true,
				executor: { model: 'test-model' },
				reviewer: { model: 'review-model' },
			},
		}),
	);
	return harness_dir;
}
const successful_process = (stdout = 'done') => ({
	lifecycle: 'succeeded' as const,
	exit_code: 0,
	stdout,
	stderr: '',
});

describe('reviewed execution', () => {
	it('rejects a harness without validation commands', () => {
		expect(() =>
			load_factory_contract({ harness_dir: make_harness([]) }),
		).toThrow('validation commands');
	});

	it('loads one authoritative pi-harness contract', () => {
		expect(
			load_factory_contract({ harness_dir: make_harness() }),
		).toMatchObject({
			task: 'Fix widget',
			cwd: '/workspace',
			validation_commands: ['check', 'test'],
			constraints: ['src/**'],
			executor_model: 'test-model',
		});
	});
	it('runs executor, validation, and independent reviewer', async () => {
		const process_runner = vi
			.fn<ProcessRunner>()
			.mockResolvedValueOnce(
				successful_process('UNTRUSTED_EXECUTOR_OUTPUT'),
			)
			.mockResolvedValueOnce(
				successful_process('{"verdict":"approve","findings":[]}'),
			);
		const command_runner = vi
			.fn()
			.mockImplementation(async (command: string) => ({
				command,
				ok: true,
				exit_code: 0,
				output: `${command} ok`,
				lifecycle: 'settled',
			}));
		const report = await start_factory(
			{ harness_dir: make_harness() },
			{
				process_runner,
				command_runner,
				changed_files: () => ['src/widget.ts'],
				diff: () => 'diff',
			},
		);
		expect(report.completion).toBe('validated');
		expect(
			command_runner.mock.calls.map(([command]) => command),
		).toEqual(['check', 'test']);
		expect(process_runner).toHaveBeenCalledTimes(2);
		expect(process_runner.mock.calls[1]?.[0]).toMatchObject({
			role: 'reviewer',
		});
		expect(process_runner.mock.calls[1]?.[0].prompt).not.toContain(
			'UNTRUSTED_EXECUTOR_OUTPUT',
		);
	});
	it('fails closed when the executor modifies dirty baseline content', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'factory-workspace-'));
		writeFileSync(join(cwd, 'dirty.ts'), 'before');
		const harness_dir = make_harness(['check'], cwd, ['dirty.ts']);
		const report = await start_factory(
			{ harness_dir },
			{
				process_runner: async () => {
					writeFileSync(join(cwd, 'dirty.ts'), 'after');
					return successful_process();
				},
			},
		);
		expect(report).toMatchObject({
			completion: 'failed',
			error:
				'Executor modified the authoritative harness contract or dirty baseline',
		});
	});

	it('stops on validation failure without review', async () => {
		const process_runner = vi
			.fn<ProcessRunner>()
			.mockResolvedValue(successful_process());
		const report = await start_factory(
			{ harness_dir: make_harness() },
			{
				process_runner,
				command_runner: async (command) => ({
					command,
					ok: false,
					exit_code: 1,
					output: 'error',
					lifecycle: 'settled',
				}),
				changed_files: () => ['src/widget.ts'],
				diff: () => '',
			},
		);
		expect(report).toMatchObject({
			completion: 'failed',
			lifecycle: 'failed',
		});
		expect(report.validation).toHaveLength(1);
		expect(process_runner).toHaveBeenCalledTimes(1);
	});
	it.each([
		['cancelled', 'cancelled'],
		['timed-out', 'timed-out'],
		['lost', 'lost'],
	] as const)(
		'propagates validator %s lifecycle',
		async (evidence_lifecycle, lifecycle) => {
			const report = await start_factory(
				{ harness_dir: make_harness() },
				{
					process_runner: async () => successful_process(),
					command_runner: async (command) => ({
						command,
						ok: false,
						exit_code: null,
						output: '',
						lifecycle: evidence_lifecycle,
					}),
					changed_files: () => [],
					diff: () => '',
				},
			);
			expect(report).toMatchObject({
				lifecycle,
				completion: 'interrupted',
			});
		},
	);

	it.each([
		['cancelled', 'interrupted'],
		['timed-out', 'interrupted'],
		['lost', 'interrupted'],
		['failed', 'failed'],
	] as const)(
		'reports executor %s truthfully',
		async (lifecycle, completion) => {
			const report = await start_factory(
				{ harness_dir: make_harness() },
				{
					process_runner: async () => ({
						lifecycle,
						exit_code: lifecycle === 'failed' ? 1 : null,
						stdout: '',
						stderr: lifecycle,
					}),
				},
			);
			expect(report).toMatchObject({ lifecycle, completion });
		},
	);
	it('fails closed on unstructured review', async () => {
		const process_runner = vi
			.fn<ProcessRunner>()
			.mockResolvedValueOnce(successful_process())
			.mockResolvedValueOnce(successful_process('looks fine'));
		const report = await start_factory(
			{ harness_dir: make_harness() },
			{
				process_runner,
				command_runner: async (command) => ({
					command,
					ok: true,
					exit_code: 0,
					output: '',
					lifecycle: 'settled',
				}),
				changed_files: () => [],
				diff: () => '',
			},
		);
		expect(report).toMatchObject({
			completion: 'refused',
			review: { verdict: 'refuse' },
		});
	});

	it('deduplicates only concurrent starts for the same contract', async () => {
		const harness_dir = make_harness();
		const process_runner = vi
			.fn<ProcessRunner>()
			.mockResolvedValueOnce(successful_process())
			.mockResolvedValueOnce(
				successful_process('{"verdict":"approve","findings":[]}'),
			);
		const dependencies = {
			process_runner,
			command_runner: async (command: string) => ({
				command,
				ok: true,
				exit_code: 0,
				output: '',
				lifecycle: 'settled' as const,
			}),
			changed_files: () => [],
			diff: () => '',
		};
		const first = start_factory({ harness_dir }, dependencies);
		const second = start_factory({ harness_dir }, dependencies);
		expect(second).toBe(first);
		await first;
		expect(process_runner).toHaveBeenCalledTimes(2);
	});

	it('fails when the reviewed workspace revision changes', async () => {
		const process_runner = vi
			.fn<ProcessRunner>()
			.mockResolvedValueOnce(successful_process())
			.mockResolvedValueOnce(
				successful_process('{"verdict":"approve","findings":[]}'),
			);
		const diff = vi
			.fn()
			.mockReturnValueOnce('validated')
			.mockReturnValueOnce('mutated');
		const report = await start_factory(
			{ harness_dir: make_harness() },
			{
				process_runner,
				command_runner: async (command) => ({
					command,
					ok: true,
					exit_code: 0,
					output: '',
					lifecycle: 'settled',
				}),
				changed_files: () => [],
				diff,
			},
		);
		expect(report).toMatchObject({
			completion: 'failed',
			error: 'Validation changed the authoritative workspace: check',
		});
	});
});
