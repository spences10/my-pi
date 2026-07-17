import { dispatch_task, route_fingerprint } from './dispatch.js';
import type { RepositoryPolicy, WorkflowKind } from './types.js';

export interface DogfoodBaselineResult {
	workflow: WorkflowKind;
	scenario: string;
	route_fingerprint: string;
	approval_gated: boolean;
	parallelism: number;
	validation_gate_ids: string[];
	status: 'route-validated';
	eligible_for_comparison: false;
	exclusion_reason: string;
}

const scenarios: Array<{
	workflow: WorkflowKind;
	task: string;
	paths: string[];
}> = [
	{
		workflow: 'chore',
		task: 'Update bounded dependency',
		paths: ['package.json'],
	},
	{
		workflow: 'feature',
		task: 'Implement export feature',
		paths: ['src/export.ts'],
	},
	{
		workflow: 'ambiguous-bug',
		task: 'Debug intermittent export bug',
		paths: ['src/**'],
	},
	{
		workflow: 'architecture',
		task: 'Research export architecture',
		paths: ['docs/**'],
	},
	{
		workflow: 'database-migration',
		task: 'Add database migration',
		paths: ['migrations/**'],
	},
];

export function run_dogfood_baseline(
	policy: RepositoryPolicy,
	cwd: string,
): DogfoodBaselineResult[] {
	return scenarios.map((scenario) => {
		const route = dispatch_task(
			{
				task: scenario.task,
				cwd,
				affected_paths: scenario.paths,
			},
			policy,
			{
				workflow: scenario.workflow,
				reason: 'Reproducible factory dogfood baseline',
			},
		);
		return {
			workflow: route.workflow.id,
			scenario: scenario.task,
			route_fingerprint: route_fingerprint(route),
			approval_gated: route.workflow.approvals.length > 0,
			parallelism: route.workflow.compute.parallelism,
			validation_gate_ids: route.workflow.validations.map(
				(gate) => gate.id,
			),
			status: 'route-validated',
			eligible_for_comparison: false,
			exclusion_reason:
				'Route-only dogfood is synthetic; measured terminal execution correlation is required for calibration',
		};
	});
}
