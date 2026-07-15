import type {
	FactoryEvent,
	FactoryMetrics,
	FactoryState,
} from './types.js';
function sum(
	events: FactoryEvent[],
	field: 'duration_ms' | 'tokens' | 'cost_usd',
): number {
	return events.reduce(
		(total, item) => total + (item[field] ?? 0),
		0,
	);
}
export function derive_factory_metrics(
	states: FactoryState[],
): FactoryMetrics[] {
	const groups = new Map<string, FactoryState[]>();
	for (const state of states) {
		const key = `${state.route.workflow.id}@${state.route.workflow.version}`;
		groups.set(key, [...(groups.get(key) ?? []), state]);
	}
	return [...groups.entries()].map(([key, runs]) => {
		const events = runs.flatMap((run) => run.events);
		const retry_events = events.filter(
			(item) => item.type === 'node.retry_scheduled',
		);
		const first_pass = runs.filter(
			(run) =>
				run.status === 'completed' &&
				!run.nodes.some((node) => node.attempts > 1),
		).length;
		const lead_time = runs.reduce(
			(total, run) =>
				total +
				Math.max(
					0,
					Date.parse(run.updated_at) - Date.parse(run.created_at),
				),
			0,
		);
		const [workflow, version] = key.split('@') as [string, string];
		return {
			workflow,
			version,
			runs: runs.length,
			contracts: runs.map((run) => ({
				workflow_id: run.workflow_id,
				version: run.contract.version,
				hash: run.contract.hash,
				task: run.contract.task,
				acceptance_criteria: [...run.contract.acceptance_criteria],
				constraints: [...run.contract.constraints],
				requested_outcome: run.contract.requested_outcome,
				status: run.contract.status,
			})),
			first_pass_success_rate: runs.length
				? first_pass / runs.length
				: 0,
			validation_retries: retry_events.filter((item) =>
				runs.some(
					(run) =>
						run.workflow_id === item.workflow_id &&
						run.nodes.find((node) => node.id === item.node_id)
							?.kind === 'validate',
				),
			).length,
			review_retries: retry_events.filter((item) =>
				runs.some(
					(run) =>
						run.workflow_id === item.workflow_id &&
						run.nodes.find((node) => node.id === item.node_id)
							?.kind === 'review',
				),
			).length,
			escalations: events.filter(
				(item) => item.type === 'node.escalated',
			).length,
			interruptions: events.filter(
				(item) => item.type === 'workflow.resumed',
			).length,
			substantial_rework: runs.filter(
				(run) =>
					run.nodes.some((node) => node.attempts > 2) ||
					run.contract_version > 1,
			).length,
			lead_time_ms: runs.length ? lead_time / runs.length : 0,
			approval_wait_ms: sum(
				events.filter((item) => item.type === 'approval.granted'),
				'duration_ms',
			),
			tokens: sum(events, 'tokens'),
			cost_usd: sum(events, 'cost_usd'),
			defects: {
				deterministic: runs
					.flatMap((run) => run.feedback)
					.filter((packet) => packet.source !== 'reviewer')
					.reduce((count, packet) => count + packet.items.length, 0),
				reviewer: runs
					.flatMap((run) => run.feedback)
					.filter((packet) => packet.source === 'reviewer')
					.reduce((count, packet) => count + packet.items.length, 0),
			},
			failures: {
				planning: events.filter(
					(item) =>
						item.type === 'failure.classified' &&
						item.metadata?.classification === 'planning',
				).length,
				implementation: events.filter(
					(item) =>
						item.type === 'failure.classified' &&
						item.metadata?.classification === 'implementation',
				).length,
			},
		};
	});
}
export function correlate_compute(
	state: FactoryState,
	correlation: {
		node_id: string;
		role: FactoryEvent['role'];
		session_id?: string;
		telemetry_run_id?: string;
		observability_session_id?: string;
		tokens?: number;
		cost_usd?: number;
		duration_ms?: number;
	},
): void {
	state.events.push({
		id: crypto.randomUUID(),
		workflow_id: state.workflow_id,
		workflow_version: state.route.workflow.version,
		type: 'compute.correlated',
		timestamp: new Date().toISOString(),
		...correlation,
	});
}
