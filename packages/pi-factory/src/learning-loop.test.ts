import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationCase } from './calibration.js';
import {
	create_observed_outcome as create_raw_observed_outcome,
	derive_calibration_report,
} from './calibration.js';
import { dispatch_task, route_fingerprint } from './dispatch.js';
import { claim_paths, create_factory_state } from './engine.js';
import {
	create_sdk_execution_adapter,
	ExecutionController,
	ExecutionRegistry,
} from './execution.js';
import {
	github_intake_adapter,
	IntakeLedger,
	preview_external_intake,
} from './intake.js';
import {
	create_recommendation,
	decide_recommendation,
	PolicyEvolutionStore,
	simulate_recommendation,
} from './recommendations.js';
import type { RepositoryPolicy } from './types.js';
const create_observed_outcome = (
	input: Parameters<typeof create_raw_observed_outcome>[0],
) =>
	create_raw_observed_outcome({
		...input,
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

describe('factory learning loop', () => {
	it('connects intake, owned execution, calibration, and a reversible canary', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'factory-loop-'));
		const canonical = github_intake_adapter.adapt(
			{
				repository: 'org/repo',
				number: 7,
				kind: 'issue',
				url: 'https://github.com/org/repo/issues/7',
				title: 'Implement export feature',
				author: 'user',
				updated_at: '2026-01-01T00:00:00Z',
				state: 'open',
				labels: ['high-risk'],
			},
			{
				cwd: directory,
				known_projects: { 'org/repo': '.' },
				trusted_source: true,
			},
		);
		const ledger = new IntakeLedger(join(directory, 'intake.json'));
		const preview = preview_external_intake(canonical, {
			hints: { workflow: 'feature' },
		});
		ledger.reconcile(preview);
		const policy: RepositoryPolicy = {
			schema_version: 1,
			policy_id: 'policy@1',
			required_approvals: ['public-contract'],
		};
		const route = dispatch_task(preview.resolved, policy);
		const state = create_factory_state(route, 'owner');
		claim_paths(state, 'owner', route.affected_paths);
		ledger.bind_workflow(canonical.source, state.workflow_id);

		const controller = new ExecutionController(
			new ExecutionRegistry(join(directory, 'executions.json')),
		);
		const adapter = create_sdk_execution_adapter({
			async run(request) {
				const evidence_id = 'plan-evidence';
				return {
					execution_id: request.execution_id,
					lifecycle: 'settled',
					adapter_id: 'sdk',
					adapter_version: '1',
					protocol_version: 1 as const,
					contract_version: request.contract_version,
					outcome: 'completed' as const,
					changed_files: [],
					evidence: [
						{
							id: evidence_id,
							kind: 'execution:plan',
							summary: 'plan completed',
						},
					],
					acceptance_results:
						request.contract.acceptance_criteria.map((criterion) => ({
							criterion,
							status: 'met' as const,
							evidence_ids: [evidence_id],
						})),
					artifact_ids: ['plan'],
				};
			},
		});
		const execution = await controller.initiate(
			state,
			'plan',
			adapter,
			{
				owner_session_id: 'owner',
				task: preview.resolved.task,
				cwd: directory,
			},
		);
		controller.apply_result(state, execution);

		const calibration_case: CalibrationCase = {
			schema_version: 1,
			case_id: 'case-1',
			case_version: '1',
			workflow: 'feature',
			workflow_version: route.workflow.version,
			risk: route.workflow.risk,
			repository_shape: 'single-package',
			project_revision: 'abc',
			policy_id: policy.policy_id,
			policy_hash: 'policy-hash',
			route_fingerprint: route_fingerprint(route),
			compute_fingerprint: 'compute',
			gate_fingerprint: 'gates',
			retry_limit: 1,
			stall_timeout_ms: route.workflow.stall_timeout_ms,
			max_parallelism: route.workflow.compute.parallelism,
			cohort: 'production',
		};
		const outcomes = Array.from({ length: 5 }, (_, index) =>
			create_observed_outcome({
				case_id: calibration_case.case_id,
				case_version: '1',
				workflow_id: `${state.workflow_id}-${index}`,
				evidence: [
					{
						id: `human-${index}`,
						kind: 'human-label',
						label: 'success',
						complete: true,
					},
				],
				first_pass: true,
				retries: 0,
				rework: false,
				lead_time_ms: 100,
				approval_wait_ms: 10,
				tokens: 100,
				cost_usd: 1,
				interrupted: false,
				escalated: false,
			}),
		);
		const experimental_case: CalibrationCase = {
			...calibration_case,
			case_id: 'case-experimental',
			policy_id: 'policy@2',
			policy_hash: 'policy-hash-2',
			stall_timeout_ms: 600000,
			cohort: 'experimental',
			experiment_id: 'exp-1',
		};
		const experimental_outcomes = Array.from(
			{ length: 5 },
			(_, index) =>
				create_observed_outcome({
					case_id: experimental_case.case_id,
					case_version: '1',
					workflow_id: `experimental-${index}`,
					evidence: [
						{
							id: `experimental-human-${index}`,
							kind: 'human-label',
							label: 'success',
							complete: true,
						},
					],
					first_pass: true,
					retries: 0,
					rework: false,
					lead_time_ms: 90,
					approval_wait_ms: 10,
					tokens: 90,
					cost_usd: 0.9,
					interrupted: false,
					escalated: false,
				}),
		);
		const report = derive_calibration_report(
			[calibration_case, experimental_case],
			[...outcomes, ...experimental_outcomes],
		);
		const evolution = new PolicyEvolutionStore(
			join(directory, 'evolution.json'),
		);
		const baseline = evolution.initialize(
			{ stall_timeout_ms: 900000 },
			'human',
		);
		const recommendation = create_recommendation({
			algorithm_version: '1',
			target: {
				scope: 'workflow',
				id: 'feature',
				field: 'stall_timeout_ms',
			},
			current_value: 900000,
			proposed_value: 600000,
			evidence_report_id: report.report_id,
			evidence_fingerprint: report.fingerprint,
			confidence: 'high',
			rationale: 'Bound escalation latency',
			expected_impact: 'Faster escalation',
			expected_cost: 'More operator alerts',
			safety: {
				classification: 'low-risk',
				invariants: ['approvals unchanged'],
			},
			rollback: {
				required: true,
				prior_version: baseline.version_id,
			},
		});
		simulate_recommendation(
			recommendation,
			report,
			report.cohorts.find((item) => item.cohort === 'production')!
				.key,
			report.cohorts.find((item) => item.cohort === 'experimental')!
				.key,
			{ success_rate: 0 },
		);
		decide_recommendation(recommendation, 'approved', {
			actor: 'human',
			authentication: 'embedding-application',
			reason: 'bounded local canary',
		});
		evolution.register(recommendation);
		const canary = evolution.apply_canary(recommendation, {
			actor: 'human',
			projects: [directory],
			workflow_kinds: ['feature'],
		});
		expect(canary.scope.projects).toEqual([directory]);
		expect(state.approvals).toEqual([]);
		expect(state.route.workflow.approvals).toContain(
			'public-contract',
		);
		expect(
			evolution.rollback(canary.version_id, 'human', 'test rollback')
				.rollback_to,
		).toBe(baseline.version_id);
	});
});
