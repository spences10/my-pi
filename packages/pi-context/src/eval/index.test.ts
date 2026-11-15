import { describe, expect, it } from 'vite-plus/test';
import { run_context_eval } from './index.js';

describe('packages/pi-context/src/eval/index.ts', () => {
	it('runs all context evals without failures', () => {
		const report = run_context_eval();

		expect(report.summary.failed).toBe(0);
		expect(report.results.map((result) => result.name)).toContain(
			'same-session-dedupe',
		);
		expect(report.results.map((result) => result.name)).toContain(
			'cross-session-dedupe-isolation',
		);
	});
});
