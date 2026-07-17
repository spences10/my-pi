import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationReport } from './calibration.js';
import { dispatch_task } from './dispatch.js';
import {
	apply_evolution_to_route,
	automatic_adjustment_allowed,
	create_recommendation,
	decide_recommendation,
	evolution_dispatch_context,
	PolicyEvolutionStore,
	recommend_calibration_change,
	simulate_recommendation,
} from './recommendations.js';

function report(
	regression = false,
	options: {
		fingerprint?: string;
		report_id?: string;
		created_at?: string;
		evolution_version_id?: string;
	} = {},
): CalibrationReport {
	const metric_values = (
		success: number,
	): CalibrationReport['cohorts'][number]['metrics'] =>
		[
			['success_rate', success],
			['first_pass_success_rate', success],
			['retries', success > 0.8 ? 0 : 1],
			['rework_rate', success > 0.8 ? 0 : 0.2],
			['interruption_rate', 0],
			['escalation_rate', 0],
			['lead_time_ms', success > 0.8 ? 90 : 100],
			['approval_wait_ms', 10],
			['tokens', success > 0.8 ? 90 : 100],
			['cost_usd', success > 0.8 ? 0.9 : 1],
		].map(([name, value]) => ({
			name: name as string,
			value: value as number,
			numerator: 10,
			denominator: 10,
			confidence: 'low' as const,
			missing: 0,
		}));
	const pins = {
		case_version: '1',
		risk: 'medium' as const,
		repository_shape: 'monorepo',
		project_revision: 'abc',
		policy_hash: 'policy',
		route_fingerprint: 'route',
		compute_fingerprint: 'compute',
		gate_fingerprint: 'gates',
		retry_limit: 1,
		max_parallelism: 1,
	};
	return {
		schema_version: 1,
		report_id: options.report_id ?? 'report-1',
		derivation_version: '1',
		created_at: options.created_at ?? new Date().toISOString(),
		thresholds: {
			minimum_sample_size: 5,
			low_confidence_sample_size: 15,
			medium_confidence_sample_size: 30,
			maximum_missing_rate: 0,
		},
		case_ids: ['case'],
		outcome_ids: ['outcome'],
		cohorts: [
			{
				key: 'prod',
				workflow: 'feature',
				workflow_version: '1',
				policy_id: 'p1',
				cohort: 'production',
				pins: { ...pins, stall_timeout_ms: 900000 },
				runs: 10,
				excluded_runs: 0,
				labels: {},
				metrics: metric_values(0.8),
				warnings: [],
				finding_scope: 'project-specific',
				project_ids: ['project'],
			},
			{
				key: 'exp',
				workflow: 'feature',
				workflow_version: '1',
				policy_id: 'p2',
				cohort: 'experimental',
				pins: {
					...pins,
					policy_hash: 'experimental-policy',
					stall_timeout_ms: 600000,
					experiment_id: 'exp-1',
					evolution_version_id: options.evolution_version_id,
				},
				runs: 10,
				excluded_runs: 0,
				labels: {},
				metrics: metric_values(regression ? 0.5 : 0.9),
				warnings: [],
				finding_scope: 'project-specific',
				project_ids: ['project'],
			},
		],
		fingerprint: options.fingerprint ?? 'fingerprint',
	};
}
function recommendation(prior_version = 'baseline') {
	return create_recommendation({
		algorithm_version: '1',
		target: {
			scope: 'workflow',
			id: 'feature',
			field: 'stall_timeout_ms',
		},
		current_value: 900000,
		proposed_value: 600000,
		evidence_report_id: 'report-1',
		evidence_fingerprint: 'fingerprint',
		confidence: 'high',
		rationale: 'Observed stalls exceed target',
		expected_impact: 'Faster escalation',
		expected_cost: 'More operator interrupts',
		safety: {
			classification: 'low-risk',
			invariants: ['does not remove gates', 'does not lower risk'],
		},
		rollback: { required: true, prior_version },
	});
}

describe('adaptive recommendations', () => {
	it('requires pinned evidence, successful simulation, and explicit approval', () => {
		const item = recommendation();
		expect(() =>
			decide_recommendation(item, 'approved', {
				actor: 'human',
				authentication: 'embedding-application',
				reason: 'looks good',
			}),
		).toThrow('simulation');
		simulate_recommendation(item, report(), 'prod', 'exp', {
			success_rate: 0,
		});
		decide_recommendation(item, 'approved', {
			actor: 'human',
			authentication: 'embedding-application',
			reason: 'bounded canary',
		});
		expect(item.status).toBe('approved');
		expect(item.history.map((entry) => entry.status)).toEqual([
			'proposed',
			'simulated',
			'approved',
		]);
	});

	it('blocks regressions, conflicting reports, and unsafe authority changes', () => {
		const item = recommendation();
		simulate_recommendation(item, report(true), 'prod', 'exp', {
			success_rate: 0,
		});
		expect(item.status).toBe('blocked');
		expect(() =>
			simulate_recommendation(
				recommendation(),
				{ ...report(), fingerprint: 'other' },
				'prod',
				'exp',
			),
		).toThrow('does not match');
		expect(() =>
			create_recommendation({
				algorithm_version: '1',
				target: {
					scope: 'project',
					id: 'repo',
					field: 'required_approvals',
				},
				current_value: ['commit'],
				proposed_value: [],
				evidence_report_id: 'r',
				evidence_fingerprint: 'f',
				confidence: 'high',
				rationale: 'faster',
				expected_impact: 'unsafe',
				expected_cost: 'none',
				safety: { classification: 'unsafe', invariants: [] },
				rollback: { required: true, prior_version: 'v1' },
			}),
		).toThrow('safety boundary');
	});

	it('rejects zero, fractional, coercible, and increasing bounded values', () => {
		for (const proposed_value of [0, 1.5, '1'])
			expect(() =>
				create_recommendation({
					...recommendation(),
					target: {
						scope: 'workflow',
						id: 'feature',
						field: 'max_parallelism',
					},
					current_value: 2,
					proposed_value,
				}),
			).toThrow();
	});

	it('allows automatic changes only after a successful simulation and explicit low-risk authorization', () => {
		const item = recommendation();
		expect(
			automatic_adjustment_allowed(item, {
				enabled: true,
				fields: ['stall_timeout_ms'],
				minimum_confidence: 'high',
			}),
		).toBe(false);
		simulate_recommendation(item, report(), 'prod', 'exp', {
			success_rate: 0,
		});
		expect(
			automatic_adjustment_allowed(item, {
				enabled: true,
				fields: ['stall_timeout_ms'],
				minimum_confidence: 'high',
			}),
		).toBe(true);
		item.target.field = 'retry_limit';
		item.current_value = 1;
		item.proposed_value = 2;
		expect(
			automatic_adjustment_allowed(item, {
				enabled: true,
				fields: ['retry_limit'],
				minimum_confidence: 'high',
			}),
		).toBe(false);
	});

	it('applies a scoped canary, blocks regressed promotion, and rolls back idempotently', () => {
		const store = new PolicyEvolutionStore(
			join(mkdtempSync(join(tmpdir(), 'evolution-')), 'store.json'),
		);
		const baseline = store.initialize(
			{ stall_timeout_ms: 900000 },
			'human',
		);
		const item = recommendation(baseline.version_id);
		simulate_recommendation(item, report(), 'prod', 'exp', {
			success_rate: 0,
		});
		decide_recommendation(item, 'approved', {
			actor: 'human',
			authentication: 'extension-ui-confirmation',
			reason: 'canary',
		});
		store.register(item);
		const canary = store.apply_canary(item, {
			actor: 'human',
			projects: ['/repo'],
			workflow_kinds: ['feature'],
		});
		expect(canary.value).toEqual({ stall_timeout_ms: 600000 });
		const route = dispatch_task(
			{ task: 'Implement feature', cwd: '/repo' },
			{
				schema_version: 1,
				policy_id: 'policy',
				required_approvals: [],
			},
			undefined,
			{
				...evolution_dispatch_context(canary),
				projects: ['/repo'],
			},
		);
		expect(route.workflow.stall_timeout_ms).toBe(600000);
		expect(route.policy_sources).toContain(
			`factory-evolution:${canary.version_id}`,
		);
		expect(() =>
			dispatch_task(
				{ task: 'Implement feature', cwd: '/repo' },
				{
					schema_version: 1,
					policy_id: 'policy',
					required_approvals: [],
				},
				undefined,
				{
					...evolution_dispatch_context(canary),
					projects: ['/repo'],
					patch: { max_parallelism: 0 },
				},
			),
		).toThrow('safe bounds');
		expect(() =>
			store.promote(
				canary.version_id,
				'human',
				report(),
				'prod',
				'exp',
			),
		).toThrow('post-canary');
		expect(() =>
			store.promote(
				canary.version_id,
				'human',
				report(true, {
					fingerprint: 'post-canary-regression',
					report_id: 'post-canary',
					created_at: new Date(Date.now() + 1000).toISOString(),
					evolution_version_id: canary.version_id,
				}),
				'prod',
				'exp',
			),
		).toThrow('Regression');
		const rolled = store.rollback(
			canary.version_id,
			'human',
			'Regression detected',
		);
		expect(rolled.rollback_to).toBe(baseline.version_id);
		expect(
			store.rollback(canary.version_id, 'human', 'again').version_id,
		).toBe(canary.version_id);
		expect(store.get().active_version).toBe(baseline.version_id);
	});

	it('refuses recommendations when either cohort contains excluded runs', () => {
		const unsafe = report();
		unsafe.cohorts[0]!.excluded_runs = 1;
		expect(
			recommend_calibration_change(unsafe, 'prod', 'exp', {
				prior_version: 'baseline',
			}),
		).toBeUndefined();
	});

	it('derives a recommendation from one controlled change and protects approved payloads', () => {
		const derived = recommend_calibration_change(
			report(),
			'prod',
			'exp',
			{ prior_version: 'baseline' },
		);
		expect(derived).toEqual(
			expect.objectContaining({
				target: {
					scope: 'workflow',
					id: 'feature',
					field: 'stall_timeout_ms',
				},
				current_value: 900000,
				proposed_value: 600000,
			}),
		);
		simulate_recommendation(derived!, report(), 'prod', 'exp');
		decide_recommendation(derived!, 'approved', {
			actor: 'human',
			authentication: 'embedding-application',
			reason: 'approve exact payload',
		});
		derived!.proposed_value = 500000;
		const store = new PolicyEvolutionStore(
			join(mkdtempSync(join(tmpdir(), 'evolution-')), 'store.json'),
		);
		store.initialize({ stall_timeout_ms: 900000 }, 'human');
		expect(() =>
			store.apply_canary(derived!, {
				actor: 'human',
				projects: ['/repo'],
				workflow_kinds: ['feature'],
			}),
		).toThrow('changed after human approval');
	});

	it('does not let rollback of an inactive canary replace the active version', () => {
		const store = new PolicyEvolutionStore(
			join(mkdtempSync(join(tmpdir(), 'evolution-')), 'store.json'),
		);
		const baseline = store.initialize(
			{ stall_timeout_ms: 900000 },
			'human',
		);
		const approve = () => {
			const item = recommendation(baseline.version_id);
			simulate_recommendation(item, report(), 'prod', 'exp');
			decide_recommendation(item, 'approved', {
				actor: 'human',
				authentication: 'embedding-application',
				reason: 'canary',
			});
			return item;
		};
		const first = store.apply_canary(approve(), {
			actor: 'human',
			projects: ['/repo-a'],
			workflow_kinds: ['feature'],
		});
		const second = store.apply_canary(approve(), {
			actor: 'human',
			projects: ['/repo-b'],
			workflow_kinds: ['feature'],
		});
		store.promote(
			first.version_id,
			'human',
			report(false, {
				fingerprint: 'post-canary-success',
				report_id: 'post-canary-success',
				created_at: new Date(Date.now() + 1000).toISOString(),
				evolution_version_id: first.version_id,
			}),
			'prod',
			'exp',
		);
		store.rollback(second.version_id, 'human', 'inactive experiment');
		expect(store.get().active_version).toBe(first.version_id);
		const route = dispatch_task(
			{ task: 'Implement feature', cwd: '/repo-a' },
			{ schema_version: 1, policy_id: 'p' },
		);
		expect(
			apply_evolution_to_route(route, first, '/repo-a').workflow
				.stall_timeout_ms,
		).toBe(600000);
	});

	it('refusal is durable and cannot become implicit approval', () => {
		const item = recommendation();
		decide_recommendation(item, 'refused', {
			actor: 'human',
			authentication: 'embedding-application',
			reason: 'insufficient data',
		});
		expect(item.status).toBe('refused');
		expect(item.history.at(-1)).toEqual(
			expect.objectContaining({
				actor: 'human',
				reason: 'insufficient data',
			}),
		);
	});
});
