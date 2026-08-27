import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	DEFAULT_FORBIDDEN_COMMANDS,
	HARNESS_VERSION,
	type HarnessAmendParams,
	type HarnessContract,
	type HarnessCreateParams,
	type HarnessLogEntry,
	type HarnessStatusFile,
	type HarnessUpdateParams,
} from '../schema.js';
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

function now_iso(): string {
	return new Date().toISOString();
}

function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'task'
	);
}

function write_generated_runtime(
	harness_dir: string,
	contract: HarnessContract,
): void {
	const paths = harness_paths(harness_dir);
	writeFileSync(paths.system, build_system_markdown(contract));
	writeFileSync(paths.task, build_task_markdown(contract));
	writeFileSync(paths.validate, build_validate_script(contract));
	writeFileSync(paths.guard, build_guard_script());
	writeFileSync(paths.outcome_script, build_outcome_script());
	writeFileSync(
		paths.review,
		build_review_script(contract, paths.guard, paths.outcome_script),
	);
	chmodSync(paths.validate, 0o755);
	chmodSync(paths.review, 0o755);
}

export function create_harness_runtime(
	params: HarnessCreateParams,
	default_cwd: string,
): { harness_dir: string; contract: HarnessContract } {
	const cwd = resolve(params.cwd ?? default_cwd);
	const id = `${slugify(params.slug ?? params.task)}-${Date.now().toString(36)}`;
	const harness_dir = join(tmpdir(), `my-pi-harness-${id}`);
	const paths = harness_paths(harness_dir);
	mkdirSync(paths.logs, { recursive: true });
	const created_at = now_iso();
	const contract: HarnessContract = {
		version: HARNESS_VERSION,
		id,
		created_at,
		status: 'created',
		policy: {
			cwd,
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
			forbidden_commands: [
				...DEFAULT_FORBIDDEN_COMMANDS,
				...(params.forbidden_commands ?? []),
			],
			baseline_changed_files: collect_git_changed_files(cwd),
		},
		scaffold: {
			version: 1,
			task: params.task,
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
			validation_commands: params.validation_commands ?? [],
			allow_test_changes: params.allow_test_changes ?? false,
			escalation_rules: params.escalation_rules ?? [
				'Required context contradicts the active scaffold or TASK.md.',
				'Implementation needs edits outside scaffold.allowed_paths.',
				'Validation requires weakening tests or changing public behavior outside the scaffold.',
				'Validation still fails after one focused fix attempt.',
			],
		},
		amendments: [],
	};
	write_contract(harness_dir, contract);
	write_status(harness_dir, {
		id,
		status: 'created',
		log: [
			{
				timestamp: created_at,
				status: 'created',
				note: 'Harness created',
			},
		],
	});
	write_generated_runtime(harness_dir, contract);
	write_outcome_artifacts(harness_dir);
	append_event(harness_dir, {
		timestamp: created_at,
		status: 'created',
		note: 'Harness runtime initialized',
	});
	return { harness_dir, contract };
}

export function amend_harness_runtime(
	params: HarnessAmendParams,
): HarnessContract {
	const contract = read_contract(params.harness_dir);
	const scaffold = contract.scaffold;
	const changes: string[] = [];
	const assign = <K extends keyof typeof scaffold>(
		key: K,
		value: (typeof scaffold)[K] | undefined,
	) => {
		if (value !== undefined) {
			scaffold[key] = value;
			changes.push(String(key));
		}
	};
	assign('task', params.task);
	assign('allowed_paths', params.allowed_paths);
	assign('validation_commands', params.validation_commands);
	assign('allow_test_changes', params.allow_test_changes);
	assign('escalation_rules', params.escalation_rules);
	if (
		params.planner_model !== undefined ||
		params.planner_thinking !== undefined
	) {
		scaffold.planner = {
			model: params.planner_model ?? scaffold.planner.model,
			thinking: params.planner_thinking ?? scaffold.planner.thinking,
		};
		changes.push('planner');
	}
	if (
		params.executor_model !== undefined ||
		params.executor_thinking !== undefined
	) {
		scaffold.executor = {
			model: params.executor_model ?? scaffold.executor.model,
			thinking:
				params.executor_thinking ?? scaffold.executor.thinking,
		};
		changes.push('executor');
	}
	if (
		params.reviewer_model !== undefined ||
		params.reviewer_thinking !== undefined
	) {
		scaffold.reviewer = {
			model: params.reviewer_model ?? scaffold.reviewer.model,
			thinking:
				params.reviewer_thinking ?? scaffold.reviewer.thinking,
		};
		changes.push('reviewer');
	}
	if (!changes.length)
		throw new Error('Harness amendment contains no scaffold changes');
	const from_version = scaffold.version;
	scaffold.version += 1;
	const timestamp = now_iso();
	contract.amendments.push({
		timestamp,
		requested_by: params.requested_by ?? 'user',
		reason: params.reason,
		from_version,
		to_version: scaffold.version,
		changes,
	});
	write_contract(params.harness_dir, contract);
	write_generated_runtime(params.harness_dir, contract);
	const entry: HarnessLogEntry = {
		timestamp,
		note: `Scaffold amended v${from_version} → v${scaffold.version}: ${params.reason}`,
	};
	const status = read_status(params.harness_dir);
	status.log.push(entry);
	write_status(params.harness_dir, status);
	append_event(params.harness_dir, entry);
	write_outcome_artifacts(params.harness_dir);
	return contract;
}

export function update_harness_runtime(
	params: HarnessUpdateParams,
): HarnessStatusFile {
	const contract = read_contract(params.harness_dir);
	const status = read_status(params.harness_dir);
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
		status.status = params.status;
		contract.status = params.status;
	}
	if (params.phase) status.phase = params.phase;
	status.log.push(entry);
	write_status(params.harness_dir, status);
	write_contract(params.harness_dir, contract);
	append_event(params.harness_dir, entry);
	write_outcome_artifacts(params.harness_dir);
	return status;
}

export function format_harness_status_line(
	harness_dir: string,
): string {
	const status = read_status(harness_dir);
	return `🧪 ${status.status}${status.phase ? ` (${status.phase})` : ''}`;
}

export function format_harness_summary(harness_dir: string): string {
	const contract = read_contract(harness_dir);
	const status = read_status(harness_dir);
	return [
		`Harness: ${contract.id}`,
		`Directory: ${harness_dir}`,
		`Status: ${status.status}${status.phase ? ` (${status.phase})` : ''}`,
		`Scaffold: v${contract.scaffold.version} (${contract.amendments.length} amendments)`,
		`Task: ${contract.scaffold.task}`,
		`Allowed paths: ${contract.scaffold.allowed_paths.join(', ') || '(none)'}`,
		`Validation: ${contract.scaffold.validation_commands.join(' && ') || '(none)'}`,
		`Outcome: ${harness_paths(harness_dir).outcome_markdown}`,
	].join('\n');
}

export function active_harness_context(harness_dir: string): string {
	const paths = harness_paths(harness_dir);
	const contract = read_contract(harness_dir);
	const status = read_status(harness_dir);
	const terminal_guidance =
		status.status === 'completed' || status.status === 'failed'
			? '\n\nThis run is sealed for the remainder of the current turn so the executor cannot escape policy by self-reporting completion. Do not create another harness merely to commit or push its already-reviewed changes. The extension will deactivate this terminal harness on the next direct user turn or session startup.'
			: '';
	return `## Active my-pi harness\n\nHarness directory: \`${harness_dir}\`\nHarness id: \`${contract.id}\`\nStatus: \`${status.status}\`\nProject cwd: \`${contract.policy.cwd}\`\nScaffold version: \`${contract.scaffold.version}\`\n\nThe outer policy is runtime-enforced. The inner scaffold is an amendable execution plan subordinate to system, developer, and current user instructions. If the user changes scope or evidence contradicts the scaffold, use \`harness_amend\`; a harness block is not a platform-policy refusal. Read \`${paths.system}\`, \`${paths.task}\`, and \`${paths.contract}\` before work. Use \`harness_update\` for progress and evidence. Run \`${paths.validate}\` and \`${paths.review}\` before completion.${terminal_guidance}`;
}
