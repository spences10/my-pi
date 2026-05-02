#!/usr/bin/env node
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EvalSuite {
	version: number;
	name: string;
	cases: EvalCase[];
}

interface EvalCase {
	id: string;
	description?: string;
	command: string;
	args?: string[];
	timeout_ms?: number;
	env?: Record<string, string>;
	requires_env?: string[];
	assert: EvalAssertions;
}

interface EvalAssertions {
	exit_code?: number;
	stdout_contains?: string[];
	stderr_contains?: string[];
	output_contains?: string[];
	stdout_not_contains?: string[];
	stderr_not_contains?: string[];
	output_not_contains?: string[];
}

interface EvalResult {
	id: string;
	status: 'pass' | 'fail' | 'skip';
	duration_ms: number;
	reason?: string;
	details?: string[];
}

function usage(): never {
	console.error(`Usage: node scripts/run-eval-suite.ts [options]

Options:
  --suite <path>     Eval suite JSON file (default: evals/smoke.json)
  --case <id>        Run one case only
  --json             Emit JSON result summary
  --bail             Stop on first failure
`);
	process.exit(2);
}

const args = process.argv.slice(2);
let suite_path = 'evals/smoke.json';
let case_filter: string | undefined;
let json_output = false;
let bail = false;

function next_value(index: number): string {
	const value = args[index + 1];
	if (!value) usage();
	return value;
}

for (let index = 0; index < args.length; index++) {
	const arg = args[index];
	if (arg === '--suite') suite_path = next_value(index++);
	else if (arg === '--case') case_filter = next_value(index++);
	else if (arg === '--json') json_output = true;
	else if (arg === '--bail') bail = true;
	else usage();
}

function read_suite(path: string): EvalSuite {
	const absolute = resolve(path);
	if (!existsSync(absolute)) {
		throw new Error(`Eval suite not found: ${path}`);
	}
	const suite = JSON.parse(
		readFileSync(absolute, 'utf-8'),
	) as EvalSuite;
	if (suite.version !== 1) {
		throw new Error(
			`Unsupported eval suite version: ${suite.version}`,
		);
	}
	if (!suite.name || !Array.isArray(suite.cases)) {
		throw new Error('Invalid eval suite: expected name and cases');
	}
	return suite;
}

function missing_env(required: string[] | undefined): string[] {
	return (required ?? []).filter((key) => !process.env[key]);
}

function includes_all(
	value: string,
	expected: string[] | undefined,
	label: string,
	details: string[],
): void {
	for (const needle of expected ?? []) {
		if (!value.includes(needle)) {
			details.push(`${label} missing ${JSON.stringify(needle)}`);
		}
	}
}

function excludes_all(
	value: string,
	forbidden: string[] | undefined,
	label: string,
	details: string[],
): void {
	for (const needle of forbidden ?? []) {
		if (value.includes(needle)) {
			details.push(`${label} contained ${JSON.stringify(needle)}`);
		}
	}
}

function evaluate_assertions(
	actual: { code: number | null; stdout: string; stderr: string },
	assertions: EvalAssertions,
): string[] {
	const details: string[] = [];
	const expected_code = assertions.exit_code ?? 0;
	if (actual.code !== expected_code) {
		details.push(
			`exit code expected ${expected_code}, got ${actual.code ?? 'null'}`,
		);
	}
	const output = `${actual.stdout}\n${actual.stderr}`;
	includes_all(
		actual.stdout,
		assertions.stdout_contains,
		'stdout',
		details,
	);
	includes_all(
		actual.stderr,
		assertions.stderr_contains,
		'stderr',
		details,
	);
	includes_all(output, assertions.output_contains, 'output', details);
	excludes_all(
		actual.stdout,
		assertions.stdout_not_contains,
		'stdout',
		details,
	);
	excludes_all(
		actual.stderr,
		assertions.stderr_not_contains,
		'stderr',
		details,
	);
	excludes_all(
		output,
		assertions.output_not_contains,
		'output',
		details,
	);
	return details;
}

function run_case(test_case: EvalCase): EvalResult {
	const started = Date.now();
	const missing = missing_env(test_case.requires_env);
	if (missing.length) {
		return {
			id: test_case.id,
			status: 'skip',
			duration_ms: Date.now() - started,
			reason: `missing env: ${missing.join(', ')}`,
		};
	}

	const child = spawnSync(test_case.command, test_case.args ?? [], {
		cwd: process.cwd(),
		env: { ...process.env, ...test_case.env },
		encoding: 'utf-8',
		timeout: test_case.timeout_ms ?? 30_000,
		maxBuffer: 10 * 1024 * 1024,
	});

	const duration_ms = Date.now() - started;
	if (child.error) {
		return {
			id: test_case.id,
			status: 'fail',
			duration_ms,
			reason: child.error.message,
		};
	}

	const details = evaluate_assertions(
		{
			code: child.status,
			stdout: child.stdout ?? '',
			stderr: child.stderr ?? '',
		},
		test_case.assert,
	);

	return {
		id: test_case.id,
		status: details.length ? 'fail' : 'pass',
		duration_ms,
		...(details.length ? { details } : {}),
	};
}

try {
	const suite = read_suite(suite_path);
	const selected = case_filter
		? suite.cases.filter((test_case) => test_case.id === case_filter)
		: suite.cases;
	if (case_filter && selected.length === 0) {
		throw new Error(`Unknown eval case: ${case_filter}`);
	}

	const results: EvalResult[] = [];
	for (const test_case of selected) {
		const result = run_case(test_case);
		results.push(result);
		if (!json_output) {
			const marker =
				result.status === 'pass'
					? '✓'
					: result.status === 'skip'
						? '-'
						: '✗';
			console.log(
				`${marker} ${test_case.id} ${result.status} (${result.duration_ms}ms)`,
			);
			for (const detail of result.details ?? []) {
				console.log(`  ${detail}`);
			}
			if (result.reason) console.log(`  ${result.reason}`);
		}
		if (bail && result.status === 'fail') break;
	}

	const summary = {
		suite: suite.name,
		path: suite_path,
		total: results.length,
		passed: results.filter((result) => result.status === 'pass')
			.length,
		failed: results.filter((result) => result.status === 'fail')
			.length,
		skipped: results.filter((result) => result.status === 'skip')
			.length,
		results,
	};

	if (json_output) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		console.log(
			`\n${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
		);
	}

	process.exit(summary.failed === 0 ? 0 : 1);
} catch (error) {
	console.error(
		error instanceof Error ? error.message : String(error),
	);
	process.exit(1);
}
