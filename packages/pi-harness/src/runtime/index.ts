import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
import { capture_baseline } from './baseline.js';
import {
	append_event,
	harness_paths,
	read_contract,
	read_status,
	write_contract,
	write_status,
} from './files.js';
import { write_outcome_artifacts } from './outcome.js';
import {
	build_guard_script,
	build_outcome_script,
	build_review_script,
	build_system_markdown,
	build_task_markdown,
	build_validate_script,
} from './renderers.js';
import {
	verify_harness,
	type HarnessVerificationOptions,
} from './verification.js';

const completing = new Set<string>();

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
	if (
		!params.validation_commands?.length ||
		params.validation_commands.some((command) => !command.trim())
	) {
		throw new Error(
			'At least one non-empty accepted validation command is required',
		);
	}
	const id = `${slugify(params.slug ?? params.task)}-${Date.now().toString(36)}`;
	const harness_dir = join(tmpdir(), `my-pi-harness-${id}`);
	const paths = harness_paths(harness_dir);
	mkdirSync(paths.logs, { recursive: true });
	const created_at = now_iso();
	const normalize_paths = (paths: string[]) =>
		paths.map((path) =>
			isAbsolute(path) ? relative(cwd, path) || '.' : path,
		);
	const allowed_paths = normalize_paths(
		params.allowed_paths ?? ['.'],
	);
	const contract: HarnessContract = {
		version: HARNESS_VERSION,
		id,
		created_at,
		status: 'created',
		policy: {
			cwd,
			forbidden_paths: normalize_paths(
				params.forbidden_paths ?? [
					'.git/**',
					'node_modules/**',
					'dist/**',
					'.env',
					'.env.*',
				],
			),
			allowed_paths: [...allowed_paths],
			allow_test_changes: params.allow_test_changes ?? true,
			validation_commands: [...params.validation_commands],
			forbidden_commands: [
				...DEFAULT_FORBIDDEN_COMMANDS,
				...(params.forbidden_commands ?? []),
			],
			...capture_baseline(cwd),
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
			allowed_paths: [...allowed_paths],
			validation_commands: [...params.validation_commands],
			allow_test_changes: params.allow_test_changes ?? true,
			escalation_rules: params.escalation_rules ?? [
				'Required context contradicts the active scaffold or TASK.md.',
				'Implementation needs edits outside scaffold.allowed_paths.',
				'Validation requires weakening tests or changing public behavior outside the scaffold.',
				'Validation exposes a decision or permission outside the accepted task.',
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
	if (
		completing.has(resolve(params.harness_dir)) ||
		read_status(params.harness_dir).status === 'completed'
	) {
		throw new Error('Cannot amend a validating or completed harness');
	}
	if (
		!contract.policy.validation_commands ||
		!contract.policy.allowed_paths
	) {
		throw new Error(
			'Recreate this legacy harness before amending its contract',
		);
	}
	if (
		params.validation_commands &&
		contract.policy.validation_commands.some(
			(command) => !params.validation_commands!.includes(command),
		)
	) {
		throw new Error(
			'Cannot remove or replace accepted validation commands',
		);
	}
	if (
		params.allow_test_changes &&
		contract.policy.allow_test_changes === false
	) {
		throw new Error('Cannot relax the accepted test restriction');
	}
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
	assign(
		'allowed_paths',
		params.allowed_paths?.map((path) =>
			isAbsolute(path)
				? relative(contract.policy.cwd, path) || '.'
				: path,
		),
	);
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
		requested_by: params.requested_by ?? 'planner',
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

export async function update_harness_runtime(
	params: HarnessUpdateParams,
	options: HarnessVerificationOptions = {},
): Promise<HarnessStatusFile> {
	if (completing.has(resolve(params.harness_dir)))
		throw new Error('Harness validation is already running');
	const contract = read_contract(params.harness_dir);
	const status = read_status(params.harness_dir);
	if (status.status === 'completed')
		throw new Error('Completed harness is sealed');
	let verification:
		| Awaited<ReturnType<typeof verify_harness>>
		| undefined;
	if (params.status === 'completed') {
		completing.add(resolve(params.harness_dir));
		try {
			verification = await verify_harness(
				params.harness_dir,
				contract,
				options,
			);
		} finally {
			completing.delete(resolve(params.harness_dir));
		}
	}
	const next_status = verification?.error ? 'failed' : params.status;
	const entry: HarnessLogEntry = {
		timestamp: now_iso(),
		status: next_status,
		phase: params.phase,
		checks: verification?.checks,
		note: params.note,
		evidence: verification?.error ?? params.evidence,
		team_status: params.team_status,
		remaining_risks: params.remaining_risks,
		changed_files: params.changed_files,
	};
	if (next_status) {
		status.status = next_status;
		contract.status = next_status;
	}
	if (params.phase) status.phase = params.phase;
	status.log.push(entry);
	write_status(params.harness_dir, status);
	write_contract(params.harness_dir, contract);
	append_event(params.harness_dir, entry);
	write_outcome_artifacts(
		params.harness_dir,
		verification?.cwd ??
			(verification ? contract.policy.cwd : options.cwd),
	);
	if (verification?.error)
		throw new Error(`Harness not completed: ${verification.error}`);
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
		`Accepted maximum scope: ${contract.policy.allowed_paths?.join(', ') ?? '(legacy contract)'}`,
		`Allowed paths (within maximum): ${contract.scaffold.allowed_paths.join(', ') || '(none)'}`,
		`Validation: ${contract.scaffold.validation_commands.join(' && ') || '(none)'}`,
		`Outcome: ${harness_paths(harness_dir).outcome_markdown}`,
	].join('\n');
}

export function active_harness_context(harness_dir: string): string {
	const paths = harness_paths(harness_dir);
	const contract = read_contract(harness_dir);
	const status = read_status(harness_dir);
	const sealed =
		status.status === 'completed'
			? '\n\nThis run is sealed: its API rejects amendments and status mutations. It deactivates on the next direct user turn or session startup. Do not create another harness merely to commit or push already-reviewed work.'
			: '';
	return `## Active task harness\n\nDirectory: ${harness_dir}\nTask: ${contract.scaffold.task}\nStatus: ${status.status}\n\nRead ${paths.contract} and ${paths.task}. Work inside the accepted maximum scope; amendments adjust strategy, not authority. Normal project test development and validation retries are allowed unless explicitly excluded. Request completed with harness_update to run accepted checks and the drift guard and record their outputs. Manual notes do not prove completion. This is workflow scaffolding, not an OS sandbox.${sealed}`;
}
