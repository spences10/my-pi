import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	HarnessContract,
	HarnessLogEntry,
	HarnessStatusFile,
} from '../schema.js';

export function json_read<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function json_write(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function shell_quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function harness_paths(harness_dir: string) {
	return {
		contract: join(harness_dir, 'harness.json'),
		system: join(harness_dir, 'SYSTEM.md'),
		task: join(harness_dir, 'TASK.md'),
		status: join(harness_dir, 'status.json'),
		outcome: join(harness_dir, 'outcome.json'),
		outcome_markdown: join(harness_dir, 'OUTCOME.md'),
		outcome_script: join(harness_dir, 'outcome.mjs'),
		validate: join(harness_dir, 'validate.sh'),
		review: join(harness_dir, 'review.sh'),
		guard: join(harness_dir, 'guard.mjs'),
		logs: join(harness_dir, 'logs'),
	};
}

export function read_contract(harness_dir: string): HarnessContract {
	return json_read<HarnessContract>(
		harness_paths(harness_dir).contract,
	);
}

export function read_status(harness_dir: string): HarnessStatusFile {
	return json_read<HarnessStatusFile>(
		harness_paths(harness_dir).status,
	);
}

export function write_status(
	harness_dir: string,
	status_file: HarnessStatusFile,
): void {
	json_write(harness_paths(harness_dir).status, status_file);
}

export function write_contract(
	harness_dir: string,
	contract: HarnessContract,
): void {
	json_write(harness_paths(harness_dir).contract, contract);
}

export function append_event(
	harness_dir: string,
	entry: HarnessLogEntry,
): void {
	const paths = harness_paths(harness_dir);
	mkdirSync(paths.logs, { recursive: true });
	writeFileSync(
		join(paths.logs, 'events.jsonl'),
		`${JSON.stringify(entry)}\n`,
		{
			flag: 'a',
		},
	);
}
