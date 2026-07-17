import { describe, expect, it } from 'vitest';
import { run_dogfood_baseline } from './dogfood.js';
import type { RepositoryPolicy } from './types.js';

const policy: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'dogfood@1',
	required_approvals: [],
};

describe('pre-calibration dogfood baseline', () => {
	it('reproduces five distinct workflows including parallel and approval-gated routes', () => {
		const results = run_dogfood_baseline(policy, process.cwd());
		expect(results.map((result) => result.workflow)).toEqual([
			'chore',
			'feature',
			'ambiguous-bug',
			'architecture',
			'database-migration',
		]);
		expect(
			results.find((result) => result.workflow === 'ambiguous-bug')
				?.parallelism,
		).toBe(2);
		expect(
			results.find(
				(result) => result.workflow === 'database-migration',
			)?.approval_gated,
		).toBe(true);
		expect(
			results.every((result) => result.validation_gate_ids.length),
		).toBe(true);
		expect(
			results.every(
				(result) => result.route_fingerprint.length === 64,
			),
		).toBe(true);
		expect(
			results.every((result) => !result.eligible_for_comparison),
		).toBe(true);
	});
});
