import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	append_event,
	harness_paths,
	read_contract,
	read_status,
	write_contract,
	write_status,
} from './files.js';
import {
	collect_git_changed_files,
	write_outcome_artifacts,
} from './outcome.js';
import {
	build_guard_script,
	build_outcome_script,
	build_review_script,
	build_system_markdown,
	build_task_markdown,
	build_validate_script,
} from './renderers.js';
import {
	DEFAULT_FORBIDDEN_COMMANDS,
	HARNESS_VERSION,
	type HarnessContract,
	type HarnessCreateParams,
	type HarnessLogEntry,
	type HarnessStatusFile,
	type HarnessUpdateParams,
} from '../schema.js';

function now_iso(): string {
	return new Date().toISOString();
}

function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'task';
}

export function create_harness_runtime(
	params: HarnessCreateParams,
	default_cwd: string,
): { harness_dir: string; contract: HarnessContract } {
	const cwd = resolve(params.cwd ?? default_cwd);
	const slug = slugify(params.slug ?? params.task);
	const id = `${slug}-${Date.now().toString(36)}`;
	const harness_dir = join(tmpdir(), `my-pi-harness-${id}`);
	const paths = harness_paths(harness_dir);
	mkdirSync(paths.logs, { recursive: true });

	const contract: HarnessContract = {
		version: HARNESS_VERSION,
		id,
		task: params.task,
		cwd,
		created_at: now_iso(),
		status: 'created',
		planner: {
			model: params.planner_model,
			thinking: params.planner_thinking,
		},
		executor: {
			model: params.executor_model,
			thinking: params.executor_thinking ?? 'low',
		},
		reviewer: {
			model: params.reviewer_model,
			thinking: params.reviewer_thinking ?? 'high',
		},
		allowed_paths: params.allowed_paths ?? ['.'],
		forbidden_paths: params.forbidden_paths ?? [
			'.git/**',
			'node_modules/**',
			'dist/**',
			'.env',
			'.env.*',
		],
		allowed_tools: [
			'read',
			'bash',
			'edit',
			'write',
			'lsp_diagnostics',
		],
		validation_commands: params.validation_commands ?? [],
		forbidden_commands: [
			...DEFAULT_FORBIDDEN_COMMANDS,
			...(params.forbidden_commands ?? []),
		],
		allow_test_changes: params.allow_test_changes ?? false,
		baseline_changed_files: collect_git_changed_files(cwd),
		escalation_rules: [
			'Required context contradicts harness.json or TASK.md.',
			'Implementation needs edits outside allowed_paths.',
			'Validation requires weakening tests or changing public behavior outside the contract.',
			'Validation still fails after one focused fix attempt.',
		],
	};

	write_contract(harness_dir, contract);
	writeFileSync(paths.system, build_system_markdown(contract));
	writeFileSync(paths.task, build_task_markdown(contract));
	write_status(harness_dir, {
		id,
		status: 'created',
		log: [
			{
				timestamp: contract.created_at,
				status: 'created',
				note: 'Harness created',
			},
		],
	});
	writeFileSync(paths.validate, build_validate_script(contract));
	writeFileSync(paths.guard, build_guard_script());
	writeFileSync(paths.outcome_script, build_outcome_script());
	write_outcome_artifacts(harness_dir);
	writeFileSync(
		paths.review,
		build_review_script(contract, paths.guard, paths.outcome_script),
	);
	chmodSync(paths.validate, 0o755);
	chmodSync(paths.review, 0o755);
	append_event(harness_dir, {
		timestamp: contract.created_at,
		status: 'created',
		note: 'Harness runtime initialized',
	});
	return { harness_dir, contract };
}

export function update_harness_runtime(
	params: HarnessUpdateParams,
): HarnessStatusFile {
	const contract = read_contract(params.harness_dir);
	const status_file = read_status(params.harness_dir);
	const entry: HarnessLogEntry = {
		timestamp: now_iso(),
		status: params.status,
		phase: params.phase,
		note: params.note,
		evidence: params.evidence,
		team_status: params.team_status,
		remaining_risks: params.remaining_risks,
		changed_files: params.changed_files,
	};
	if (params.status) {
		status_file.status = params.status;
		contract.status = params.status;
	}
	if (params.phase) status_file.phase = params.phase;
	status_file.log.push(entry);
	write_status(params.harness_dir, status_file);
	write_contract(params.harness_dir, contract);
	append_event(params.harness_dir, entry);
	write_outcome_artifacts(params.harness_dir);
	return status_file;
}

export function format_harness_summary(harness_dir: string): string {
	const contract = read_contract(harness_dir);
	const status_file = read_status(harness_dir);
	return [
		`Harness: ${contract.id}`,
		`Directory: ${harness_dir}`,
		`Status: ${status_file.status}${status_file.phase ? ` (${status_file.phase})` : ''}`,
		`Task: ${contract.task}`,
		`Allowed paths: ${contract.allowed_paths.join(', ') || '(none)'}`,
		`Validation: ${contract.validation_commands.join(' && ') || '(none)'}`,
		`Outcome: ${harness_paths(harness_dir).outcome_markdown}`,
	].join('\n');
}

export function active_harness_context(harness_dir: string): string {
	const paths = harness_paths(harness_dir);
	const contract = read_contract(harness_dir);
	const status_file = read_status(harness_dir);
	return `## Active my-pi harness

Harness directory: \`${harness_dir}\`
Harness id: \`${contract.id}\`
Status: \`${status_file.status}\`
Project cwd: \`${contract.cwd}\`

Read \`${paths.system}\`, \`${paths.task}\`, and \`${paths.contract}\` before work. Use \`harness_update\` to record phase changes, decisions, validation evidence, team status, remaining risks, and completion. Run \`${paths.validate}\` before declaring completion and \`${paths.review}\` before final review. Review \`${paths.outcome_markdown}\` or \`${paths.outcome}\` for the final outcome artifact.`;
}
