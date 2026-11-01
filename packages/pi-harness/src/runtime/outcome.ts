import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
	HarnessLogEntry,
	HarnessOutcome,
	HarnessPolicy,
} from '../schema.js';
import { collect_task_changed_files } from './baseline.js';
import {
	harness_paths,
	json_write,
	read_contract,
	read_status,
} from './files.js';

function now_iso(): string {
	return new Date().toISOString();
}

function unique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter(Boolean) as string[])];
}

function changed_files(
	cwd: string,
	log: HarnessLogEntry[],
	policy: HarnessPolicy,
): string[] {
	const logged_files = log.flatMap(
		(entry) => entry.changed_files ?? [],
	);
	return unique([
		...collect_task_changed_files(cwd, policy),
		...logged_files,
	]).sort();
}

function latest_log_value<K extends keyof HarnessLogEntry>(
	log: HarnessLogEntry[],
	key: K,
): HarnessLogEntry[K] | undefined {
	return [...log]
		.reverse()
		.find((entry) => entry[key] !== undefined)?.[key];
}

export function collect_harness_outcome(
	harness_dir: string,
	cwd = process.env.HARNESS_CWD,
): HarnessOutcome {
	const contract = read_contract(harness_dir);
	const status_file = read_status(harness_dir);
	const execution_cwd = resolve(cwd ?? contract.policy.cwd);
	const validation_evidence = status_file.log
		.filter((entry) => entry.evidence)
		.map((entry) => ({
			timestamp: entry.timestamp,
			phase: entry.phase,
			evidence: entry.evidence ?? '',
		}));
	const remaining_risks =
		latest_log_value(status_file.log, 'remaining_risks') ??
		(status_file.status === 'failed'
			? ['Harness marked failed; inspect status.json.']
			: []);

	return {
		id: contract.id,
		status: status_file.status,
		phase: status_file.phase,
		task: contract.scaffold.task,
		cwd: contract.policy.cwd,
		execution_cwd,
		generated_at: now_iso(),
		changed_files: changed_files(
			execution_cwd,
			status_file.log,
			contract.policy,
		),
		baseline_changed_files: contract.policy.baseline_changed_files,
		validation: {
			commands: contract.scaffold.validation_commands,
			evidence: validation_evidence,
		},
		team_status:
			latest_log_value(status_file.log, 'team_status') ??
			'not recorded',
		remaining_risks,
		log: status_file.log,
	};
}

function list(values: string[], empty: string): string {
	return values.length
		? values.map((value) => `- ${value}`).join('\n')
		: `- ${empty}`;
}

export function render_outcome_markdown(
	outcome: HarnessOutcome,
): string {
	const validation_evidence = outcome.validation.evidence.length
		? outcome.validation.evidence
				.map((entry) => {
					const phase = entry.phase ? ` (${entry.phase})` : '';
					return `- ${entry.timestamp}${phase}: ${entry.evidence}`;
				})
				.join('\n')
		: '- No validation evidence recorded';
	return `# Harness outcome: ${outcome.id}

- Status: ${outcome.status}${outcome.phase ? ` (${outcome.phase})` : ''}
- Generated: ${outcome.generated_at}
- Project cwd: ${outcome.cwd}
- Execution cwd: ${outcome.execution_cwd}

## Task

${outcome.task}

## Changed files

${list(outcome.changed_files, 'No changed files detected')}

## Baseline files

${list(outcome.baseline_changed_files, 'No dirty baseline files recorded')}

## Validation evidence

Commands:
${list(outcome.validation.commands, 'No validation commands configured')}

Evidence:
${validation_evidence}

## Team status

${outcome.team_status}

## Remaining risks

${list(outcome.remaining_risks, 'No remaining risks recorded')}
`;
}

export function write_outcome_artifacts(
	harness_dir: string,
): HarnessOutcome {
	const outcome = collect_harness_outcome(harness_dir);
	const paths = harness_paths(harness_dir);
	json_write(paths.outcome, outcome);
	writeFileSync(
		paths.outcome_markdown,
		render_outcome_markdown(outcome),
	);
	return outcome;
}
