import { describe, expect, it } from 'vitest';
import { run_context_eval } from './index.js';

describe('packages/pi-context/src/eval/index.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./index.js')).resolves.toBeDefined();
	});

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
