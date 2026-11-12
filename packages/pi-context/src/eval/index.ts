import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextStore } from '../store.js';
import {
	run_capture_evals,
	run_cost_evals,
	run_dedupe_evals,
	run_lifecycle_evals,
	run_retention_evals,
	run_retrieval_evals,
	run_search_evals,
} from './checks.js';
import { PROJECT, SESSION, seed } from './fixtures.js';
import { build_sections, format_report } from './report.js';
import type { EvalCaseResult, EvalReport } from './types.js';

export function run_context_eval(): EvalReport {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-eval-'));
	const db_path = join(dir, 'context.db');

	const store = new ContextStore({
		db_path,
		project_path: PROJECT,
		session_id: SESSION,
	});

	try {
		const seeded = seed(store);
		const results: EvalCaseResult[] = [];

		run_search_evals(store, seeded, results);
		run_retrieval_evals(store, seeded, results);
		run_lifecycle_evals(store, seeded, results);
		run_capture_evals(results);
		run_retention_evals(store, results);
		run_cost_evals(store, seeded, results);
		run_dedupe_evals(results);

		const passed = results.filter((result) => result.passed).length;
		const total = results.length;

		const returned_bytes = results.reduce(
			(sum, result) => sum + result.returned_bytes,
			0,
		);

		return {
			version: 1,
			summary: {
				passed,
				failed: total - passed,
				total,
				score_pct: Math.round((passed / total) * 1000) / 10,
				returned_bytes,
			},
			sections: build_sections(results),
			results,
		};
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function run_context_eval_cli(
	args = process.argv.slice(2),
): Promise<void> {
	const json = args.includes('--json');
	const report = run_context_eval();
	process.stdout.write(
		json
			? `${JSON.stringify(report, null, 2)}\n`
			: `${format_report(report)}\n`,
	);

	if (report.summary.failed > 0) process.exitCode = 1;
}

export type {
	EvalCaseResult,
	EvalCategory,
	EvalReport,
} from './types.js';
