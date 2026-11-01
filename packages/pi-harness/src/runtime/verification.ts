import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
	HarnessContract,
	HarnessValidationCheck,
} from '../schema.js';
import { collect_git_changed_files, file_state } from './baseline.js';
import { shell_quote } from './files.js';
import { build_guard_script } from './renderers.js';

export interface HarnessVerificationOptions {
	cwd?: string;
	signal?: AbortSignal;
	run?: (
		command: string,
		cwd: string,
		signal?: AbortSignal,
	) => Promise<{ passed: boolean; output: string }>;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		'git',
		['--no-optional-locks', '-C', cwd, ...args],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	).trimEnd();
}

function workspace_state(
	cwd: string,
	contract: HarnessContract,
): string {
	const paths = [
		...new Set([
			...collect_git_changed_files(cwd),
			...(cwd === resolve(contract.policy.cwd)
				? Object.keys(contract.policy.baseline_file_states ?? {})
				: []),
		]),
	].sort();
	const files = paths.map((path) => {
		const state = file_state(cwd, path);
		if (state === undefined)
			throw new Error(
				`Cannot verify an unsupported working-state path: ${path}`,
			);
		return [path, state];
	});
	let head: string;
	try {
		head = git(cwd, 'rev-parse', '--verify', 'HEAD');
	} catch {
		head = git(cwd, 'symbolic-ref', 'HEAD');
	}
	return createHash('sha256')
		.update(
			JSON.stringify({
				head,
				files,
			}),
		)
		.digest('hex');
}

export function resolve_harness_cwd(
	contract: HarnessContract,
	candidate = contract.policy.cwd,
): string {
	const cwd = resolve(candidate);
	if (
		cwd !== resolve(contract.policy.cwd) &&
		git(
			cwd,
			'rev-parse',
			'--path-format=absolute',
			'--git-common-dir',
		) !==
			git(
				contract.policy.cwd,
				'rev-parse',
				'--path-format=absolute',
				'--git-common-dir',
			)
	) {
		throw new Error(
			'Validation cwd must be the accepted repository or one of its linked worktrees',
		);
	}
	return cwd;
}

export async function verify_harness(
	harness_dir: string,
	contract: HarnessContract,
	options: HarnessVerificationOptions,
): Promise<{
	checks: HarnessValidationCheck[];
	error?: string;
	cwd?: string;
}> {
	const checks: HarnessValidationCheck[] = [];
	const attempt = randomUUID();
	let cwd: string | undefined;
	try {
		if (!options.run)
			throw new Error(
				'Completion requires a validation execution backend; notes are not proof',
			);
		if (
			!contract.policy.validation_commands?.length ||
			!contract.policy.allowed_paths
		) {
			throw new Error(
				'Recreate this harness with accepted validation commands and scope before execution',
			);
		}
		cwd = resolve_harness_cwd(contract, options.cwd);
		const before = workspace_state(cwd, contract);
		const contract_before = readFileSync(
			join(harness_dir, 'harness.json'),
			'utf8',
		);
		writeFileSync(
			join(harness_dir, 'guard.mjs'),
			build_guard_script(),
		);
		const commands = [
			...new Set([
				...contract.policy.validation_commands,
				...contract.scaffold.validation_commands,
			]),
			`HARNESS_CWD=${shell_quote(cwd)} node ${shell_quote(join(harness_dir, 'guard.mjs'))}`,
		];
		for (const command of commands) {
			options.signal?.throwIfAborted();
			const result = await options.run(command, cwd, options.signal);
			const output_file = join(
				harness_dir,
				'logs',
				`validation-${attempt}-${checks.length}.log`,
			);
			writeFileSync(output_file, result.output.slice(0, 1024 * 1024));
			const passed =
				result.passed === true && !options.signal?.aborted;
			checks.push({ command, passed, output_file });
			if (!passed)
				throw new Error(
					`Validation failed or was interrupted: ${command}`,
				);
		}
		options.signal?.throwIfAborted();
		if (
			readFileSync(join(harness_dir, 'harness.json'), 'utf8') !==
				contract_before ||
			workspace_state(cwd, contract) !== before
		) {
			throw new Error(
				'Contract or workspace changed during validation; rerun against the final artifact',
			);
		}
		return { checks, cwd };
	} catch (error) {
		return {
			checks,
			cwd,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
