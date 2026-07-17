import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	CalibrationSuiteStore,
	create_calibration_suite,
	define_factory_calibration_suite,
	evaluate_calibration_suite,
	import_factory_outcome,
	propose_calibration_experiments,
} from './calibration-suite.js';
import {
	create_observed_outcome,
	type CalibrationCase,
	type ObservedOutcome,
} from './calibration.js';
import { dispatch_task } from './dispatch.js';
import { run_dogfood_baseline } from './dogfood.js';
import {
	create_factory_state,
	record_workflow_outcome,
} from './engine.js';
import type { RepositoryPolicy, WorkflowKind } from './types.js';

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
const policy: RepositoryPolicy = {
	schema_version: 1,
	policy_id: 'suite-policy@1',
	required_approvals: [],
};
const projects = [
	{
		project_id: 'monorepo',
		repository_shape: 'typescript-monorepo',
		project_revision: 'revision-a',
		policy_id: policy.policy_id,
		policy_hash: 'policy-a',
	},
	{
		project_id: 'service',
		repository_shape: 'single-service',
		project_revision: 'revision-b',
		policy_id: policy.policy_id,
		policy_hash: 'policy-b',
	},
];
function cases(): CalibrationCase[] {
	return workflows.map((workflow, index) => {
		const project = projects[index % projects.length]!;
		return {
			schema_version: 1,
			case_id: `${workflow}-case`,
			case_version: '1',
			workflow,
			workflow_version: '1.0.0',
			risk:
				workflow === 'incident'
					? 'critical'
					: workflow === 'chore'
						? 'low'
						: 'high',
			repository_shape: project.repository_shape,
			project_revision: project.project_revision,
			policy_id: project.policy_id,
			policy_hash: project.policy_hash,
			route_fingerprint: `route-${workflow}`,
			compute_fingerprint: `compute-${workflow}`,
			gate_fingerprint: `gates-${workflow}`,
			retry_limit: workflow === 'chore' ? 0 : 2,
			stall_timeout_ms: workflow === 'incident' ? 300000 : 900000,
			max_parallelism: workflow === 'ambiguous-bug' ? 2 : 1,
			cohort: 'production',
			suite_id: 'factory-real-world',
			suite_version: '1',
			project_id: project.project_id,
			provider: index % 2 ? 'anthropic' : 'openai',
			model: index % 2 ? 'claude' : 'gpt',
			reasoning: index % 2 ? 'high' : 'medium',
		};
	});
}
function measured_outcomes(
	calibration_cases: CalibrationCase[],
): ObservedOutcome[] {
	return calibration_cases.flatMap((item) =>
		Array.from({ length: 2 }, (_, index) =>
			create_observed_outcome({
				case_id: item.case_id,
				case_version: item.case_version,
				workflow_id: `${item.workflow}-${index}`,
				provenance: {
					kind: 'authenticated-import',
					source_id: `${item.case_id}-${index}`,
					suite_id: item.suite_id,
					suite_version: item.suite_version,
					case_id: item.case_id,
					case_version: item.case_version,
					project_id: item.project_id,
					project_revision: item.project_revision,
					policy_id: item.policy_id,
					policy_hash: item.policy_hash,
					route_fingerprint: item.route_fingerprint,
					compute_fingerprint: item.compute_fingerprint,
					gate_fingerprint: item.gate_fingerprint,
				},
				evidence: [
					{
						id: `${item.case_id}-${index}`,
						kind: 'validation',
						label: 'success',
						complete: true,
					},
				],
				correlation: {
					status: 'measured',
					provider: item.provider,
					model: item.model,
					reasoning: item.reasoning,
					session_id: `session-${index}`,
					telemetry_run_id: `run-${item.case_id}-${index}`,
					terminal_outcome: 'completed',
					authoritative_delivery: true,
					duration_ms: 100,
				},
				first_pass: index === 0,
				retries: index,
				rework: index > 0,
				lead_time_ms: 1000 + index,
				approval_wait_ms:
					item.workflow === 'database-migration' ? 50 : 0,
				tokens: 100 + index,
				cost_usd: 0.1 + index / 100,
				interrupted: false,
				escalated: false,
			}),
		),
	);
}

describe('versioned calibration suites', () => {
	it('defines every workflow across projects, risks, providers, and reasoning policies', () => {
		const suite = define_factory_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects,
			compute_targets: [
				{
					provider: 'openai',
					model: 'gpt',
					reasoning: 'medium',
					cohort: 'production',
				},
				{
					provider: 'anthropic',
					model: 'claude',
					reasoning: 'high',
					cohort: 'experimental',
					experiment_id: 'provider-experiment',
				},
			],
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		});
		expect(new Set(suite.cases.map((item) => item.workflow))).toEqual(
			new Set(workflows),
		);
		expect(suite.cases).toHaveLength(32);
		expect(
			new Set(suite.cases.map((item) => item.project_id)).size,
		).toBe(2);
		expect(
			new Set(suite.cases.map((item) => item.provider)).size,
		).toBe(2);
		expect(
			new Set(suite.cases.map((item) => item.reasoning)).size,
		).toBe(2);
		expect(
			suite.dogfood.every((item) => !item.eligible_for_comparison),
		).toBe(true);
	});

	it('keeps an evidence-free real baseline explicitly blocked', () => {
		const suite = create_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects,
			cases: cases(),
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		});
		const evaluation = evaluate_calibration_suite(suite, []);
		expect(evaluation.baseline_status).toBe('blocked');
		expect(evaluation.blocking_reasons).toContainEqual(
			expect.stringContaining(
				'insufficient measured sample coverage',
			),
		);
		const proposals = propose_calibration_experiments(
			suite,
			evaluation,
		);
		expect(new Set(proposals.map((item) => item.workflow))).toEqual(
			new Set(workflows),
		);
		expect(
			proposals.every((item) => item.mutates_policy === false),
		).toBe(true);
	});

	it('creates a reproducible valid report only from complete measured outcomes', () => {
		const suite = create_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects,
			cases: cases(),
			thresholds: {
				minimum_sample_size: 2,
				low_confidence_sample_size: 3,
				medium_confidence_sample_size: 5,
				maximum_missing_rate: 0,
			},
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		});
		const outcomes = measured_outcomes(suite.cases);
		const first = evaluate_calibration_suite(suite, outcomes);
		const second = evaluate_calibration_suite(suite, outcomes);
		expect(first.baseline_status).toBe('valid');
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(
			first.report.cohorts.every(
				(cohort) => cohort.excluded_runs === 0,
			),
		).toBe(true);
		expect(
			first.report.cohorts.every(
				(cohort) => cohort.finding_scope === 'project-specific',
			),
		).toBe(true);
		expect(first.bias_warnings).toHaveLength(8);
		const forged = structuredClone(outcomes);
		forged[0]!.provenance!.kind = 'synthetic';
		const rejected = evaluate_calibration_suite(suite, forged);
		expect(rejected.baseline_status).toBe('blocked');
		expect(
			rejected.report.cohorts.some(
				(cohort) => cohort.excluded_runs > 0,
			),
		).toBe(true);
	});

	it('imports labels and measurements only from explicit durable factory evidence', () => {
		const route = dispatch_task(
			{
				task: 'Implement measured feature',
				cwd: process.cwd(),
				affected_paths: ['src/**'],
			},
			policy,
		);
		const state = create_factory_state(route, 'owner');
		state.nodes.find((node) => node.id === 'plan')!.attempts = 1;
		state.events.push(
			{
				id: 'failure',
				workflow_id: state.workflow_id,
				workflow_version: route.workflow.version,
				node_id: 'plan',
				type: 'failure.classified',
				timestamp: new Date().toISOString(),
				metadata: { classification: 'operator-misuse' },
			},
			{
				id: 'execution',
				workflow_id: state.workflow_id,
				workflow_version: route.workflow.version,
				node_id: 'plan',
				type: 'execution.lifecycle',
				timestamp: new Date().toISOString(),
				role: 'planner',
				attempt: 1,
				session_id: 'owner',
				duration_ms: 25,
				telemetry_run_id: 'run',
				tokens: 12,
				cost_usd: 0.02,
				metadata: {
					execution_id: 'execution',
					provider: 'provider',
					model: 'model',
					reasoning: 'high',
					contract_version: state.contract_version,
					lifecycle: 'failed',
					outcome: 'failed',
					read_only: false,
				},
			},
		);
		record_workflow_outcome(state, {
			status: 'failed',
			authoritative: true,
			classification: 'operator-misuse',
			evidence_ids: [],
		});
		const calibration_case = define_factory_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects: [projects[0]!],
			compute_targets: [
				{
					provider: 'provider',
					model: 'model',
					reasoning: 'high',
					cohort: 'production',
				},
			],
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		}).cases.find((item) => item.workflow === 'feature')!;
		const authenticated = {
			authenticated: true as const,
			source_id: state.workflow_id,
			suite_id: calibration_case.suite_id!,
			suite_version: calibration_case.suite_version!,
			case_id: calibration_case.case_id,
			case_version: calibration_case.case_version,
			project_id: calibration_case.project_id!,
			project_revision: calibration_case.project_revision,
			policy_id: calibration_case.policy_id,
			policy_hash: calibration_case.policy_hash,
		};
		const imported = import_factory_outcome(
			state,
			calibration_case,
			authenticated,
		);
		expect(imported).toMatchObject({
			label: 'operator-defect',
			tokens: 12,
			cost_usd: 0.02,
			correlation: {
				status: 'measured',
				terminal_outcome: 'failed',
			},
		});
		const incompatible_imports = [
			[calibration_case, undefined],
			[
				calibration_case,
				{ ...authenticated, project_revision: 'forged-revision' },
			],
			[
				calibration_case,
				{ ...authenticated, policy_hash: 'forged-policy' },
			],
			[
				{ ...calibration_case, route_fingerprint: 'forged-route' },
				authenticated,
			],
			[
				{ ...calibration_case, gate_fingerprint: 'forged-gates' },
				authenticated,
			],
			[
				{
					...calibration_case,
					compute_fingerprint: 'forged-compute',
				},
				authenticated,
			],
			[
				calibration_case,
				{ ...authenticated, suite_version: 'forged-suite' },
			],
			[
				calibration_case,
				{ ...authenticated, case_id: 'forged-case' },
			],
		] as const;
		for (const [target, provenance] of incompatible_imports)
			expect(
				import_factory_outcome(state, target, provenance),
			).toMatchObject({ correlation: { status: 'uncorrelated' } });

		const incomplete = create_factory_state(route, 'owner');
		expect(
			import_factory_outcome(
				incomplete,
				calibration_case,
				authenticated,
			),
		).toMatchObject({
			label: 'incomplete',
			correlation: { status: 'uncorrelated' },
		});
	});

	it('excludes ineligible rows from coverage and evidence proposals', () => {
		const suite = create_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects,
			cases: cases(),
			thresholds: {
				minimum_sample_size: 2,
				low_confidence_sample_size: 3,
				medium_confidence_sample_size: 5,
				maximum_missing_rate: 0,
			},
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		});
		const outcomes = measured_outcomes(suite.cases);
		for (const outcome of outcomes.filter(
			(item) => item.case_id === 'feature-case',
		))
			outcome.provenance!.kind = 'synthetic';
		const evaluation = evaluate_calibration_suite(suite, outcomes);
		expect(evaluation.workflow_total.feature).toBe(2);
		expect(evaluation.workflow_coverage.feature).toBe(0);
		expect(evaluation.workflow_excluded.feature).toBe(2);
		const proposal = propose_calibration_experiments(
			suite,
			evaluation,
		).find((item) => item.workflow === 'feature');
		expect(proposal?.rationale).toContain('Collect 2 additional');
	});

	it('stores, queries, and exports exact suite/report/project revisions', () => {
		const suite = create_calibration_suite({
			suite_id: 'factory-real-world',
			suite_version: '1',
			projects,
			cases: cases(),
			dogfood: run_dogfood_baseline(policy, process.cwd()),
		});
		const outcomes = measured_outcomes(suite.cases);
		const evaluation = evaluate_calibration_suite(suite, outcomes);
		const store = new CalibrationSuiteStore(
			join(
				mkdtempSync(join(tmpdir(), 'factory-suite-')),
				'ledger.json',
			),
		);
		store.put_suite(suite);
		store.put_outcomes(outcomes);
		store.put_evaluation(evaluation);
		const query = store.query({
			workflow: 'feature',
			project_id: 'service',
		});
		expect(query.suites[0]?.suite_version).toBe('1');
		expect(query.suites[0]?.projects).toEqual(projects);
		expect(
			query.outcomes.every((item) => item.case_id === 'feature-case'),
		).toBe(true);
		expect(store.export_json({ workflow: 'feature' })).toContain(
			'revision-b',
		);
	});

	it('rejects any attempt to promote synthetic dogfood', () => {
		const dogfood = run_dogfood_baseline(policy, process.cwd());
		Reflect.set(dogfood[0]!, 'eligible_for_comparison', true);
		expect(() =>
			create_calibration_suite({
				suite_id: 'factory-real-world',
				suite_version: '1',
				projects,
				cases: cases(),
				dogfood,
			}),
		).toThrow('Synthetic dogfood');
	});
});
