import type {
	FactoryEvent,
	FactoryMetrics,
	FactoryState,
	FailureClassification,
	WorkflowOutcomeStatus,
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

function has_compute_correlation(run: FactoryState): boolean {
	const expected_role = (kind: string): FactoryEvent['role'] =>
		kind === 'plan'
			? 'planner'
			: kind === 'review'
				? 'reviewer'
				: 'executor';
	const complete = (event: FactoryEvent): boolean => {
		const node = run.nodes.find((item) => item.id === event.node_id);
		return Boolean(
			node &&
			['plan', 'execute', 'review'].includes(node.kind) &&
			event.role === expected_role(node.kind) &&
			event.session_id &&
			typeof event.metadata?.execution_id === 'string' &&
			typeof event.metadata?.provider === 'string' &&
			event.metadata.provider &&
			typeof event.metadata?.model === 'string' &&
			event.metadata.model &&
			typeof event.metadata?.reasoning === 'string' &&
			event.metadata.reasoning &&
			event.metadata.contract_version === run.contract_version &&
			typeof event.attempt === 'number' &&
			event.attempt >= 1 &&
			typeof event.duration_ms === 'number' &&
			Number.isFinite(event.duration_ms) &&
			event.duration_ms >= 0 &&
			(Boolean(event.telemetry_run_id) ||
				Boolean(event.observability_session_id) ||
				(event.tokens !== undefined && event.tokens > 0) ||
				(event.cost_usd !== undefined && event.cost_usd > 0)),
		);
	};
	const lifecycle = run.events.filter(
		(event) => event.type === 'execution.lifecycle',
	);
	if (!lifecycle.length || !lifecycle.every(complete)) return false;
	const executed = run.nodes.filter(
		(node) =>
			['plan', 'execute', 'review'].includes(node.kind) &&
			node.attempts > 0,
	);
	if (!executed.length) return false;
	return executed.every((node) => {
		for (let attempt = 1; attempt <= node.attempts; attempt += 1)
			if (
				!lifecycle.some(
					(event) =>
						event.node_id === node.id &&
						event.attempt === attempt &&
						event.metadata?.read_only !== true,
				)
			)
				return false;
		return lifecycle.some(
			(event) =>
				event.node_id === node.id &&
				event.attempt === node.attempts &&
				event.metadata?.read_only === false &&
				['settled', 'succeeded'].includes(
					String(event.metadata.lifecycle),
				) &&
				event.metadata.outcome === 'completed' &&
				event.role === expected_role(node.kind) &&
				complete(event),
		);
	});
}

function delivered(run: FactoryState): boolean {
	return (
		run.outcome?.status === 'completed' &&
		run.outcome.authoritative &&
		run.status === 'completed' &&
		run.nodes.some(
			(node) =>
				node.kind === 'complete' && node.status === 'succeeded',
		) &&
		!run.nodes.some(
			(node) =>
				['validate', 'review', 'approval'].includes(node.kind) &&
				node.status !== 'succeeded',
		)
	);
}

const failure_classes: FailureClassification[] = [
	'workflow-failure',
	'executor-failure',
	'operator-misuse',
	'project-policy-failure',
	'validation-failure',
	'platform-failure',
];
const outcome_statuses: Array<WorkflowOutcomeStatus | 'unresolved'> =
	[
		'completed',
		'failed',
		'cancelled',
		'superseded',
		'completed-outside-factory',
		'unresolved',
	];

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
		const eligible = runs.filter(
			(run) => delivered(run) && has_compute_correlation(run),
		);
		const retry_events = events.filter(
			(item) => item.type === 'node.retry_scheduled',
		);
		const first_pass = eligible.filter(
			(run) => !run.nodes.some((node) => node.attempts > 1),
		).length;
		const lead_time = eligible.reduce(
			(total, run) =>
				total +
				Math.max(
					0,
					Date.parse(run.updated_at) - Date.parse(run.created_at),
				),
			0,
		);
		const [workflow, version] = key.split('@') as [string, string];
		const outcomes = Object.fromEntries(
			outcome_statuses.map((status) => [
				status,
				runs.filter(
					(run) => (run.outcome?.status ?? 'unresolved') === status,
				).length,
			]),
		) as FactoryMetrics['outcomes'];
		const interruptions = events.filter(
			(event) =>
				event.type === 'ownership.stalled' ||
				event.type === 'workflow.resumed' ||
				(event.type === 'execution.lifecycle' &&
					event.metadata?.lifecycle === 'lost'),
		).length;
		return {
			workflow,
			version,
			runs: runs.length,
			eligible_runs: eligible.length,
			excluded_runs: runs.length - eligible.length,
			outcomes,
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
			first_pass_success_rate: eligible.length
				? first_pass / eligible.length
				: 0,
			validation_retries: retry_events.filter((event) =>
				runs.some(
					(run) =>
						run.workflow_id === event.workflow_id &&
						run.nodes.find((node) => node.id === event.node_id)
							?.kind === 'validate',
				),
			).length,
			review_retries: retry_events.filter((event) =>
				runs.some(
					(run) =>
						run.workflow_id === event.workflow_id &&
						run.nodes.find((node) => node.id === event.node_id)
							?.kind === 'review',
				),
			).length,
			escalations: events.filter(
				(event) => event.type === 'node.escalated',
			).length,
			interruptions,
			handoffs: events.filter(
				(event) => event.type === 'ownership.transferred',
			).length,
			takeovers: runs.filter(
				(run) =>
					run.events.some(
						(event) => event.type === 'ownership.stalled',
					) &&
					run.events.some(
						(event) => event.type === 'ownership.transferred',
					),
			).length,
			session_losses: events.filter(
				(event) =>
					event.type === 'ownership.stalled' ||
					(event.type === 'execution.lifecycle' &&
						event.metadata?.lifecycle === 'lost'),
			).length,
			cancellations: outcomes.cancelled,
			supersessions: outcomes.superseded,
			substantial_rework: runs.filter(
				(run) =>
					run.nodes.some((node) => node.attempts > 2) ||
					run.contract_version > 1,
			).length,
			lead_time_ms: eligible.length ? lead_time / eligible.length : 0,
			approval_wait_ms: sum(
				events.filter((event) => event.type === 'approval.granted'),
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
			failures: Object.fromEntries(
				failure_classes.map((classification) => [
					classification,
					events.filter(
						(event) =>
							event.type === 'failure.classified' &&
							event.metadata?.classification === classification,
					).length,
				]),
			) as FactoryMetrics['failures'],
		};
	});
}

export function correlate_compute(
	state: FactoryState,
	correlation: {
		node_id: string;
		role: FactoryEvent['role'];
		session_id: string;
		execution_id: string;
		lifecycle:
			| 'settled'
			| 'succeeded'
			| 'failed'
			| 'cancelled'
			| 'lost';
		outcome?:
			| 'completed'
			| 'incomplete'
			| 'refused'
			| 'escalated'
			| 'failed';
		read_only: boolean;
		provider?: string;
		model?: string;
		reasoning?: string;
		telemetry_run_id?: string;
		observability_session_id?: string;
		tokens?: number;
		cost_usd?: number;
		duration_ms?: number;
	},
): void {
	if (
		!correlation.telemetry_run_id &&
		!correlation.observability_session_id &&
		!(correlation.tokens !== undefined && correlation.tokens > 0) &&
		!(correlation.cost_usd !== undefined && correlation.cost_usd > 0)
	)
		throw new Error(
			'Compute correlation requires measured usage or telemetry evidence',
		);
	const node = state.nodes.find(
		(item) => item.id === correlation.node_id,
	);
	if (!node)
		throw new Error('Compute correlation references an unknown node');
	if (
		correlation.duration_ms === undefined ||
		!Number.isFinite(correlation.duration_ms) ||
		correlation.duration_ms < 0 ||
		!correlation.provider ||
		!correlation.model ||
		!correlation.reasoning
	)
		throw new Error(
			'Compute correlation requires provider, model, reasoning, and valid duration',
		);
	state.events.push({
		id: crypto.randomUUID(),
		workflow_id: state.workflow_id,
		workflow_version: state.route.workflow.version,
		type: 'execution.lifecycle',
		timestamp: new Date().toISOString(),
		...correlation,
		attempt: node.attempts,
		metadata: {
			execution_id: correlation.execution_id,
			provider: correlation.provider,
			model: correlation.model,
			reasoning: correlation.reasoning,
			contract_version: state.contract_version,
			lifecycle: correlation.lifecycle,
			outcome: correlation.outcome,
			read_only: correlation.read_only,
		},
	});
}
