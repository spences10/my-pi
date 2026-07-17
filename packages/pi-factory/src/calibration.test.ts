import { describe, expect, it } from 'vitest';
import type {
	CalibrationCase,
	OutcomeEvidence,
} from './calibration.js';
import {
	compare_calibration_cohorts,
	create_observed_outcome as create_raw_observed_outcome,
	derive_calibration_report,
	label_outcome,
} from './calibration.js';
import type { WorkflowKind } from './types.js';

const workflows: WorkflowKind[] = [
	'chore',
	'feature',
	'ambiguous-bug',
	'ui-copy',
	'database-migration',
	'incident',
	'architecture',
	'safe-release',
];
function calibration_case(
	workflow: WorkflowKind,
	cohort: 'production' | 'experimental' = 'production',
	index = 1,
): CalibrationCase {
	return {
		schema_version: 1,
		case_id: `${workflow}-${cohort}-${index}`,
		case_version: '1',
		workflow,
		workflow_version: '1.0.0',
		risk: workflow === 'incident' ? 'critical' : 'medium',
		repository_shape: 'monorepo',
		project_revision: 'abc',
		policy_id: cohort === 'production' ? 'policy@1' : 'policy@2',
		policy_hash: cohort,
		route_fingerprint: 'route',
		compute_fingerprint: 'compute',
		gate_fingerprint: 'gates',
		retry_limit: 1,
		stall_timeout_ms: 1000,
		max_parallelism: 1,
		cohort,
		...(cohort === 'experimental' ? { experiment_id: 'exp-1' } : {}),
	};
}
function create_observed_outcome(
	input: Parameters<typeof create_raw_observed_outcome>[0],
) {
	return create_raw_observed_outcome({
		...input,
		provenance: input.provenance ?? {
			kind: 'authenticated-import',
			source_id: 'test-source',
		},
		correlation: input.correlation ?? {
			status: 'measured',
			provider: 'test-provider',
			model: 'test-model',
			reasoning: 'medium',
			session_id: 'test-session',
			telemetry_run_id: 'test-run',
			duration_ms: 10,
			terminal_outcome: 'completed',
			authoritative_delivery: true,
		},
	});
}
function evidence(
	label: OutcomeEvidence['label'],
	overrides = {},
): OutcomeEvidence[] {
	return [
		{
			id: `e-${label}`,
			kind: 'human-label',
			label,
			complete: true,
			...overrides,
		},
	];
}

describe('calibration evidence', () => {
	it('declares representative cases for every workflow kind', () => {
		const cases = workflows.map((workflow) =>
			calibration_case(workflow),
		);
		expect(new Set(cases.map((item) => item.workflow))).toEqual(
			new Set(workflows),
		);
		expect(
			cases.every(
				(item) =>
					item.policy_hash &&
					item.route_fingerprint &&
					item.gate_fingerprint,
			),
		).toBe(true);
	});

	it('labels only from explicit complete, non-conflicting evidence', () => {
		expect(label_outcome([])).toBe('incomplete');
		expect(
			label_outcome([{ id: '1', kind: 'event', complete: false }]),
		).toBe('incomplete');
		expect(
			label_outcome([
				...evidence('success'),
				...evidence('executor-defect'),
			]),
		).toBe('conflicting-evidence');
		expect(label_outcome(evidence('platform-failure'))).toBe(
			'platform-failure',
		);
	});

	it('separates versions/cohorts and reports sparse, missing, and incomplete evidence', () => {
		const production = calibration_case('feature');
		const experimental = calibration_case('feature', 'experimental');
		const outcomes = [
			create_observed_outcome({
				case_id: production.case_id,
				case_version: '1',
				workflow_id: 'w1',
				evidence: evidence('success'),
				first_pass: true,
				retries: 0,
			}),
			create_observed_outcome({
				case_id: production.case_id,
				case_version: '1',
				workflow_id: 'w2',
				evidence: [
					{ id: 'missing', kind: 'telemetry', complete: false },
				],
			}),
			create_observed_outcome({
				case_id: experimental.case_id,
				case_version: '1',
				workflow_id: 'w3',
				evidence: evidence('executor-defect'),
				first_pass: false,
				retries: 1,
			}),
		];
		const report = derive_calibration_report(
			[production, experimental],
			outcomes,
		);
		expect(report.cohorts).toHaveLength(2);
		expect(
			report.cohorts.find((item) => item.cohort === 'production')
				?.warnings,
		).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Sparse'),
				expect.stringContaining('Incomplete'),
			]),
		);
		expect(report.fingerprint).toHaveLength(64);
	});

	it('is reproducible apart from report identity and compares experiments without mutation', () => {
		const cases = [
			calibration_case('feature'),
			calibration_case('feature', 'experimental'),
		];
		const outcomes = cases.flatMap((item, index) =>
			Array.from({ length: 5 }, (_, run) =>
				create_observed_outcome({
					case_id: item.case_id,
					case_version: '1',
					workflow_id: `${index}-${run}`,
					evidence: evidence(
						index
							? 'success'
							: run === 0
								? 'executor-defect'
								: 'success',
					),
					first_pass: index === 1 || run > 0,
					retries: index === 1 ? 0 : 1,
					rework: index === 0,
					lead_time_ms: index === 1 ? 90 : 100,
					approval_wait_ms: 10,
					tokens: index === 1 ? 90 : 100,
					cost_usd: index === 1 ? 0.9 : 1,
					interrupted: false,
					escalated: false,
				}),
			),
		);
		const first = derive_calibration_report(cases, outcomes);
		const second = derive_calibration_report(cases, outcomes);
		expect(first.fingerprint).toBe(second.fingerprint);
		const comparison = compare_calibration_cohorts(
			first,
			first.cohorts.find((item) => item.cohort === 'production')!.key,
			first.cohorts.find((item) => item.cohort === 'experimental')!
				.key,
		);
		expect(comparison.comparable).toBe(true);
		expect(comparison.deltas.success_rate).toBeGreaterThan(0);
	});

	it('blocks incompatible projects and incomplete-run survivorship bias', () => {
		const production = calibration_case('feature');
		const experimental = {
			...calibration_case('feature', 'experimental'),
			project_revision: 'different-revision',
			repository_shape: 'single-package',
		};
		const outcomes = [production, experimental].flatMap((item) =>
			Array.from({ length: 5 }, (_, index) =>
				create_observed_outcome({
					case_id: item.case_id,
					case_version: item.case_version,
					workflow_id: `${item.case_id}-${index}`,
					evidence: evidence('success'),
					first_pass: true,
					retries: 0,
					rework: false,
					lead_time_ms: 10,
					approval_wait_ms: 0,
					tokens: 10,
					cost_usd: 1,
					interrupted: false,
					escalated: false,
				}),
			),
		);
		const report = derive_calibration_report(
			[production, experimental],
			outcomes,
		);
		expect(
			compare_calibration_cohorts(
				report,
				report.cohorts.find((item) => item.cohort === 'production')!
					.key,
				report.cohorts.find((item) => item.cohort === 'experimental')!
					.key,
			).comparable,
		).toBe(false);

		const compatible = calibration_case('feature', 'experimental');
		const incomplete = Array.from({ length: 5 }, (_, index) =>
			create_observed_outcome({
				case_id: compatible.case_id,
				case_version: compatible.case_version,
				workflow_id: `incomplete-${index}`,
				evidence: [
					{ id: `missing-${index}`, kind: 'event', complete: false },
				],
			}),
		);
		const biased = derive_calibration_report(
			[production, compatible],
			[
				...outcomes.filter(
					(item) => item.case_id === production.case_id,
				),
				...incomplete,
			],
		);
		expect(
			compare_calibration_cohorts(
				biased,
				biased.cohorts.find((item) => item.cohort === 'production')!
					.key,
				biased.cohorts.find((item) => item.cohort === 'experimental')!
					.key,
			).comparable,
		).toBe(false);
	});

	it('excludes missing, synthetic, and uncorrelated measurements from comparison', () => {
		const production = calibration_case('feature');
		const experimental = calibration_case('feature', 'experimental');
		const outcomes = [production, experimental].flatMap((item) =>
			Array.from({ length: 5 }, () =>
				create_raw_observed_outcome({
					case_id: item.case_id,
					case_version: item.case_version,
					workflow_id: item.workflow,
					evidence: evidence('success'),
					first_pass: true,
					retries: 0,
					rework: false,
					lead_time_ms: 10,
					approval_wait_ms: 0,
					tokens: 10,
					cost_usd: 1,
					interrupted: false,
					escalated: false,
					correlation: {
						status:
							item.cohort === 'production'
								? 'uncorrelated'
								: 'synthetic',
						terminal_outcome: 'completed',
						authoritative_delivery: true,
					},
				}),
			),
		);
		const report = derive_calibration_report(
			[production, experimental],
			outcomes,
		);
		expect(
			report.cohorts.every((cohort) => cohort.excluded_runs === 5),
		).toBe(true);
		const comparison = compare_calibration_cohorts(
			report,
			report.cohorts.find((cohort) => cohort.cohort === 'production')!
				.key,
			report.cohorts.find(
				(cohort) => cohort.cohort === 'experimental',
			)!.key,
		);
		expect(comparison.comparable).toBe(false);
		expect(comparison.warnings).toContainEqual(
			expect.stringContaining('Excluded uncorrelated or synthetic'),
		);
	});

	it('rejects incompatible or unreproducible outcomes', () => {
		const item = calibration_case('feature');
		const outcome = create_observed_outcome({
			case_id: item.case_id,
			case_version: '2',
			workflow_id: 'w',
			evidence: evidence('success'),
		});
		expect(() =>
			derive_calibration_report([item], [outcome]),
		).toThrow('incompatible');
		outcome.case_version = '1';
		outcome.label = 'executor-defect';
		expect(() =>
			derive_calibration_report([item], [outcome]),
		).toThrow('not reproducible');
	});
});
