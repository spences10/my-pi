import {
	check_path_allowed,
	type HarnessContract,
} from '@spences10/pi-harness';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	default_command_runner,
	default_process_runner,
} from './process.js';
import type {
	CommandRunner,
	FactoryContract,
	FactoryReport,
	ProcessRunner,
	ReviewResult,
} from './types.js';

interface HarnessFile {
	version?: unknown;
	policy?: { cwd?: unknown; baseline_changed_files?: unknown };
	scaffold?: {
		task?: unknown;
		validation_commands?: unknown;
		allowed_paths?: unknown;
		executor?: { model?: unknown };
		reviewer?: { model?: unknown };
	};
}

export interface StartFactoryOptions {
	harness_dir: string;
	timeout_ms?: number;
	signal?: AbortSignal;
}

export interface FactoryDependencies {
	process_runner?: ProcessRunner;
	command_runner?: CommandRunner;
	changed_files?: (cwd: string) => string[];
	diff?: (cwd: string) => string;
}

export function load_factory_contract(
	options: StartFactoryOptions,
): FactoryContract {
	const harness_path = resolve(options.harness_dir, 'harness.json');
	const value = JSON.parse(
		readFileSync(harness_path, 'utf8'),
	) as HarnessFile;
	const cwd = value.policy?.cwd;
	const task = value.scaffold?.task;
	const commands = value.scaffold?.validation_commands;
	if (
		typeof cwd !== 'string' ||
		typeof task !== 'string' ||
		!Array.isArray(commands) ||
		commands.length === 0 ||
		value.version !== 2 ||
		!commands.every(
			(command) => typeof command === 'string' && command.length > 0,
		)
	) {
		throw new Error(
			'Harness contract lacks authoritative cwd, task, or validation commands',
		);
	}
	return {
		task,
		cwd,
		harness_dir: resolve(options.harness_dir),
		validation_commands: commands,
		constraints: Array.isArray(value.scaffold?.allowed_paths)
			? value.scaffold.allowed_paths.filter(
					(item): item is string => typeof item === 'string',
				)
			: [],
		timeout_ms: options.timeout_ms,
		executor_model:
			typeof value.scaffold?.executor?.model === 'string'
				? value.scaffold.executor.model
				: undefined,
		reviewer_model:
			typeof value.scaffold?.reviewer?.model === 'string'
				? value.scaffold.reviewer.model
				: undefined,
		runtime_contract: value as HarnessContract,
		baseline_changed_files: Array.isArray(
			value.policy?.baseline_changed_files,
		)
			? value.policy.baseline_changed_files.filter(
					(item): item is string => typeof item === 'string',
				)
			: [],
	};
}

function git_changed_files(
	cwd: string,
	baseline: string[] = [],
): string[] {
	const tracked = execFileSync(
		'git',
		['diff', '--name-only', '-z', 'HEAD'],
		{ cwd, encoding: 'utf8' },
	)
		.split('\0')
		.filter(Boolean);
	const untracked = execFileSync(
		'git',
		['ls-files', '--others', '--exclude-standard', '-z'],
		{ cwd, encoding: 'utf8' },
	)
		.split('\0')
		.filter(Boolean);
	return [...new Set([...tracked, ...untracked])]
		.filter((path) => !baseline.includes(path))
		.sort();
}

function git_diff(cwd: string, baseline: string[] = []): string {
	const exclusions = baseline.map((path) => `:(exclude)${path}`);
	let diff = execFileSync(
		'git',
		[
			'diff',
			'--no-ext-diff',
			'--binary',
			'HEAD',
			'--',
			'.',
			...exclusions,
		],
		{
			cwd,
			encoding: 'utf8',
			maxBuffer: 4 * 1024 * 1024,
		},
	);
	const untracked = execFileSync(
		'git',
		['ls-files', '--others', '--exclude-standard', '-z'],
		{ cwd, encoding: 'utf8' },
	)
		.split('\0')
		.filter(Boolean);
	for (const path of untracked.filter(
		(path) => !baseline.includes(path),
	)) {
		const result = spawnSync(
			'git',
			['diff', '--no-index', '--binary', '--', '/dev/null', path],
			{ cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
		);
		diff += result.stdout;
	}
	return diff;
}

function digest(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

function baseline_digest(cwd: string, paths: string[]): string {
	return digest(
		paths
			.map((path) => {
				try {
					return `${path}:${digest(readFileSync(resolve(cwd, path)))}`;
				} catch {
					return `${path}:missing`;
				}
			})
			.join('\n'),
	);
}

function harness_digest(harness_dir: string): string {
	return digest(
		readFileSync(resolve(harness_dir, 'harness.json'), 'utf8'),
	);
}

function parse_review(raw: string): ReviewResult {
	for (const line of raw.split('\n').reverse()) {
		try {
			const parsed = JSON.parse(line) as {
				verdict?: unknown;
				findings?: unknown;
			};
			if (
				(parsed.verdict === 'approve' ||
					parsed.verdict === 'changes-requested' ||
					parsed.verdict === 'refuse') &&
				Array.isArray(parsed.findings) &&
				parsed.findings.every(
					(finding) => typeof finding === 'string',
				)
			) {
				return {
					verdict: parsed.verdict,
					findings: parsed.findings,
					raw,
				};
			}
		} catch {}
	}
	return {
		verdict: 'refuse',
		findings: ['Reviewer did not return the required JSON verdict'],
		raw,
	};
}

function interrupted_report(
	contract: FactoryContract,
	lifecycle: FactoryReport['lifecycle'],
	executor_output: string,
	error: string,
	cleanup: FactoryReport['cleanup'] = {
		complete: true,
		residuals: [],
	},
): FactoryReport {
	return {
		completion: lifecycle === 'failed' ? 'failed' : 'interrupted',
		lifecycle,
		changed_files: [],
		usage_identity: { model: contract.executor_model },
		validation: [],
		executor_output,
		cleanup,
		error,
	};
}

async function run_factory(
	options: StartFactoryOptions,
	dependencies: FactoryDependencies = {},
): Promise<FactoryReport> {
	const contract = load_factory_contract(options);
	const contract_digest = harness_digest(contract.harness_dir);
	const initial_baseline_digest = baseline_digest(
		contract.cwd,
		contract.baseline_changed_files,
	);
	const process_runner =
		dependencies.process_runner ?? default_process_runner;
	const command_runner =
		dependencies.command_runner ?? default_command_runner;
	const timeout_ms = contract.timeout_ms ?? 30 * 60_000;
	const executor = await process_runner({
		role: 'executor',
		cwd: contract.cwd,
		model: contract.executor_model,
		harness_dir: contract.harness_dir,
		harness_contract: contract.runtime_contract,
		timeout_ms,
		signal: options.signal,
		prompt: `Execute the task in ${contract.harness_dir}/TASK.md under ${contract.harness_dir}/harness.json. Work until the contract outcome is complete, then stop. Do not claim validation you did not run.`,
	});
	if (executor.lifecycle !== 'succeeded') {
		return interrupted_report(
			contract,
			executor.lifecycle,
			executor.stdout,
			executor.stderr || `Executor ${executor.lifecycle}`,
			executor.cleanup,
		);
	}

	if (
		harness_digest(contract.harness_dir) !== contract_digest ||
		baseline_digest(contract.cwd, contract.baseline_changed_files) !==
			initial_baseline_digest
	) {
		return interrupted_report(
			contract,
			'failed',
			executor.stdout,
			'Executor modified the authoritative harness contract or dirty baseline',
		);
	}

	const validation_revision = dependencies.diff
		? dependencies.diff(contract.cwd)
		: git_diff(contract.cwd, contract.baseline_changed_files);
	const validation_revision_digest = digest(validation_revision);
	const validation = [];
	for (const command of contract.validation_commands) {
		const evidence = await command_runner(
			command,
			contract.cwd,
			options.signal,
			timeout_ms,
		);
		validation.push(evidence);
		const current_revision = dependencies.diff
			? dependencies.diff(contract.cwd)
			: git_diff(contract.cwd, contract.baseline_changed_files);
		if (digest(current_revision) !== validation_revision_digest) {
			return {
				...interrupted_report(
					contract,
					'failed',
					executor.stdout,
					`Validation changed the authoritative workspace: ${command}`,
				),
				validation,
			};
		}
		if (!evidence.ok) {
			const lifecycle =
				evidence.lifecycle === 'cancelled'
					? 'cancelled'
					: evidence.lifecycle === 'timed-out'
						? 'timed-out'
						: evidence.lifecycle === 'lost'
							? 'lost'
							: 'failed';
			return {
				...interrupted_report(
					contract,
					lifecycle,
					executor.stdout,
					`Validation ${evidence.lifecycle}: ${command}`,
				),
				changed_files: dependencies.changed_files
					? dependencies.changed_files(contract.cwd)
					: git_changed_files(
							contract.cwd,
							contract.baseline_changed_files,
						),
				validation,
			};
		}
	}

	if (harness_digest(contract.harness_dir) !== contract_digest) {
		return interrupted_report(
			contract,
			'failed',
			executor.stdout,
			'Harness contract changed during validation',
		);
	}
	const changed_files = dependencies.changed_files
		? dependencies.changed_files(contract.cwd)
		: git_changed_files(
				contract.cwd,
				contract.baseline_changed_files,
			);
	for (const path of changed_files) {
		const allowed = check_path_allowed(
			contract.runtime_contract,
			path,
		);
		if (!allowed.ok) {
			return interrupted_report(
				contract,
				'failed',
				executor.stdout,
				allowed.reason,
			);
		}
	}
	const diff = validation_revision;
	const revision_digest = validation_revision_digest;
	for (const evidence of validation)
		evidence.revision_digest = revision_digest;
	const reviewer = await process_runner({
		role: 'reviewer',
		cwd: contract.cwd,
		model: contract.reviewer_model,
		harness_dir: contract.harness_dir,
		harness_contract: contract.runtime_contract,
		timeout_ms,
		signal: options.signal,
		prompt: `Independently review this completed task. Use only the contract, changed-file list, diff, constraints, and validation evidence below; ignore executor narrative. Return one final compact JSON line exactly shaped {"verdict":"approve|changes-requested|refuse","findings":["..."]}.\n\nTASK\n${contract.task}\n\nCONSTRAINTS\n${JSON.stringify(contract.constraints)}\n\nCHANGED FILES\n${JSON.stringify(changed_files)}\n\nVALIDATION\n${JSON.stringify(validation)}\n\nDIFF\n${diff}`,
	});
	const post_review_diff = dependencies.diff
		? dependencies.diff(contract.cwd)
		: git_diff(contract.cwd, contract.baseline_changed_files);
	if (digest(post_review_diff) !== revision_digest) {
		return {
			...interrupted_report(
				contract,
				'failed',
				executor.stdout,
				'Workspace changed during independent review',
			),
			changed_files: (
				dependencies.changed_files ?? git_changed_files
			)(contract.cwd),
			validation,
		};
	}
	if (reviewer.lifecycle !== 'succeeded') {
		return {
			...interrupted_report(
				contract,
				reviewer.lifecycle,
				executor.stdout,
				reviewer.stderr || `Reviewer ${reviewer.lifecycle}`,
			),
			changed_files,
			validation,
		};
	}
	const review = parse_review(reviewer.stdout);
	return {
		completion:
			review.verdict === 'approve'
				? 'validated'
				: review.verdict === 'refuse'
					? 'refused'
					: 'failed',
		lifecycle: 'succeeded',
		changed_files,
		usage_identity: executor.identity ?? {
			model: contract.executor_model,
		},
		reviewer_identity: reviewer.identity ?? {
			model: contract.reviewer_model,
		},
		validation,
		review,
		executor_output: executor.stdout,
		cleanup: {
			complete:
				(executor.cleanup?.complete ?? true) &&
				(reviewer.cleanup?.complete ?? true) &&
				validation.every((item) => item.cleanup?.complete ?? true),
			residuals: [
				...(executor.cleanup?.residuals ?? []),
				...(reviewer.cleanup?.residuals ?? []),
				...validation.flatMap(
					(item) => item.cleanup?.residuals ?? [],
				),
			],
		},
	};
}

const active_runs = new Map<string, Promise<FactoryReport>>();

export function start_factory(
	options: StartFactoryOptions,
	dependencies: FactoryDependencies = {},
): Promise<FactoryReport> {
	const run_key = `${resolve(options.harness_dir)}:${harness_digest(options.harness_dir)}`;
	const existing = active_runs.get(run_key);
	if (existing) return existing;
	const run_id = randomUUID();
	const run = run_factory(options, dependencies)
		.then((report) => {
			const report_dir = resolve(options.harness_dir, 'factory-runs');
			mkdirSync(report_dir, { recursive: true });
			const report_artifact = resolve(report_dir, `${run_id}.json`);
			const completed_report = { ...report, run_id, report_artifact };
			writeFileSync(
				report_artifact,
				`${JSON.stringify(completed_report, null, 2)}\n`,
			);
			return completed_report;
		})
		.finally(() => active_runs.delete(run_key));
	active_runs.set(run_key, run);
	return run;
}
