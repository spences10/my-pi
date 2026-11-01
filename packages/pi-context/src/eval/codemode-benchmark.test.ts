import { describe, expect, it } from 'vite-plus/test';
import { run_codemode_benchmark } from './codemode-benchmark.js';

describe('native codemode benchmark', () => {
	it('filters nested data without captures and retains searchable final overflow', async () => {
		const previous_db = process.env.MY_PI_CONTEXT_DB;
		const report = await run_codemode_benchmark(undefined, 1);
		expect(process.env.MY_PI_CONTEXT_DB).toBe(previous_db);
		expect(report.results).toHaveLength(10);
		expect(report.results.every((result) => result.correct)).toBe(
			true,
		);
		const current = report.results.filter(
			(result) => result.variant === 'codemode-first',
		);
		for (const result of current.filter((result) =>
			result.scenario.endsWith('-filter'),
		)) {
			expect(result.top_level_calls).toBe(1);
			expect(result.nested_calls).toBe(1);
			expect(result.stored_sources).toBe(0);
			expect(result.retrieval_calls).toBe(0);
			expect(result.model_facing_bytes).toBeLessThan(100);
		}
		const overflow = current.find(
			(result) => result.scenario === 'final-overflow',
		)!;
		expect(overflow.stored_sources).toBe(1);
		expect(overflow.retrieval_calls).toBe(1);
		expect(overflow.model_facing_bytes).toBeLessThan(1400);
		const native_overflow = report.results.find(
			(result) =>
				result.variant === 'native-only' &&
				result.scenario === 'final-overflow',
		)!;
		expect(native_overflow.model_facing_bytes).toBeGreaterThan(
			overflow.model_facing_bytes,
		);
	}, 30_000);

	it.each([0, -1, 1.5, 21, NaN])(
		'rejects invalid repeat count %s',
		async (runs) => {
			await expect(
				run_codemode_benchmark(undefined, runs),
			).rejects.toThrow('runs must be an integer');
		},
	);
});
