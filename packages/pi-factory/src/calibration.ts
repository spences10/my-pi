import { createHash, randomUUID } from 'node:crypto';
import type { Risk, WorkflowKind } from './types.js';

export type OutcomeLabel =
	| 'success'
	| 'classifier-error'
	| 'workflow-policy-defect'
	| 'repository-policy-defect'
	| 'planner-defect'
	| 'executor-defect'
	| 'reviewer-defect'
	| 'operator-defect'
	| 'external-failure'
	| 'platform-failure'
	| 'incomplete'
	| 'conflicting-evidence';
export interface CalibrationCase {
	schema_version: 1;
	case_id: string;
	case_version: string;
	workflow: WorkflowKind;
	workflow_version: string;
	risk: Risk;
	repository_shape: string;
	project_revision: string;
	policy_id: string;
	policy_hash: string;
	route_fingerprint: string;
	compute_fingerprint: string;
	gate_fingerprint: string;
	retry_limit: number;
	stall_timeout_ms: number;
	max_parallelism: number;
	cohort: 'production' | 'experimental';
	experiment_id?: string;
	evolution_version_id?: string;
	suite_id?: string;
	suite_version?: string;
	project_id?: string;
	provider?: string;
	model?: string;
	reasoning?: string;
}
export interface OutcomeEvidence {
	id: string;
	kind:
		| 'event'
		| 'validation'
		| 'review'
		| 'human-label'
		| 'telemetry';
	label?: OutcomeLabel;
	value?: number;
	complete: boolean;
	contradictory?: boolean;
}
export interface OutcomeCorrelation {
	status: 'measured' | 'synthetic' | 'uncorrelated';
	provider?: string;
	model?: string;
	reasoning?: string;
	session_id?: string;
	telemetry_run_id?: string;
	observability_session_id?: string;
	terminal_outcome?:
		| 'completed'
		| 'failed'
		| 'cancelled'
		| 'superseded'
		| 'completed-outside-factory';
	authoritative_delivery?: boolean;
	duration_ms?: number;
}
export interface OutcomeProvenance {
	kind: 'factory-state' | 'authenticated-import' | 'synthetic';
	source_id: string;
	suite_id?: string;
	suite_version?: string;
	project_revision?: string;
	policy_hash?: string;
}
export interface ObservedOutcome {
	schema_version: 1;
	outcome_id: string;
	case_id: string;
	case_version: string;
	workflow_id: string;
	observed_at: string;
	evidence: OutcomeEvidence[];
	label: OutcomeLabel;
	correlation?: OutcomeCorrelation;
	provenance?: OutcomeProvenance;
	first_pass?: boolean;
	retries?: number;
	rework?: boolean;
	lead_time_ms?: number;
	approval_wait_ms?: number;
	tokens?: number;
	cost_usd?: number;
	interrupted?: boolean;
	escalated?: boolean;
}
export interface CalibrationThresholds {
	minimum_sample_size: number;
	low_confidence_sample_size: number;
	medium_confidence_sample_size: number;
	maximum_missing_rate: number;
}
export interface CalibrationMetric {
	name: string;
	value: number | null;
	numerator: number;
	denominator: number;
	confidence: 'insufficient' | 'low' | 'medium' | 'high';
	missing: number;
}
export interface CalibrationCohortPins {
	case_version: string;
	risk: Risk;
	repository_shape: string;
	project_revision: string;
	policy_hash: string;
	route_fingerprint: string;
	compute_fingerprint: string;
	gate_fingerprint: string;
	retry_limit: number;
	stall_timeout_ms: number;
	max_parallelism: number;
	experiment_id?: string;
	evolution_version_id?: string;
}
export interface CalibrationReport {
	schema_version: 1;
	report_id: string;
	derivation_version: string;
	created_at: string;
	thresholds: CalibrationThresholds;
	case_ids: string[];
	outcome_ids: string[];
	cohorts: Array<{
		key: string;
		workflow: WorkflowKind;
		workflow_version: string;
		policy_id: string;
		cohort: CalibrationCase['cohort'];
		pins: CalibrationCohortPins;
		runs: number;
		excluded_runs: number;
		labels: Partial<Record<OutcomeLabel, number>>;
		metrics: CalibrationMetric[];
		warnings: string[];
		finding_scope: 'project-specific' | 'general';
		project_ids: string[];
	}>;
	fingerprint: string;
}
function sha(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex');
}
export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
	minimum_sample_size: 5,
	low_confidence_sample_size: 15,
	medium_confidence_sample_size: 30,
	maximum_missing_rate: 0,
};
function confidence(
	denominator: number,
	thresholds: CalibrationThresholds,
): CalibrationMetric['confidence'] {
	if (denominator < thresholds.minimum_sample_size)
		return 'insufficient';
	if (denominator < thresholds.low_confidence_sample_size)
		return 'low';
	if (denominator < thresholds.medium_confidence_sample_size)
		return 'medium';
	return 'high';
}
function rate(
	name: string,
	values: Array<boolean | undefined>,
	thresholds: CalibrationThresholds,
): CalibrationMetric {
	const present = values.filter(
		(value): value is boolean => value !== undefined,
	);
	const numerator = present.filter(Boolean).length;
	return {
		name,
		value: present.length ? numerator / present.length : null,
		numerator,
		denominator: present.length,
		confidence: confidence(present.length, thresholds),
		missing: values.length - present.length,
	};
}
function average(
	name: string,
	values: Array<number | undefined>,
	thresholds: CalibrationThresholds,
): CalibrationMetric {
	const present = values.filter(
		(value): value is number =>
			value !== undefined && Number.isFinite(value),
	);
	return {
		name,
		value: present.length
			? present.reduce((sum, value) => sum + value, 0) /
				present.length
			: null,
		numerator: present.length,
		denominator: present.length,
		confidence: confidence(present.length, thresholds),
		missing: values.length - present.length,
	};
}
export function label_outcome(
	evidence: OutcomeEvidence[],
): OutcomeLabel {
	if (!evidence.length || evidence.some((item) => !item.complete))
		return 'incomplete';
	if (evidence.some((item) => item.contradictory))
		return 'conflicting-evidence';
	const labels = [
		...new Set(
			evidence
				.map((item) => item.label)
				.filter((item): item is OutcomeLabel => Boolean(item)),
		),
	];
	if (!labels.length) return 'incomplete';
	if (labels.length > 1) return 'conflicting-evidence';
	return labels[0]!;
}
export function create_observed_outcome(
	input: Omit<
		ObservedOutcome,
		'schema_version' | 'outcome_id' | 'observed_at' | 'label'
	>,
): ObservedOutcome {
	return {
		...input,
		schema_version: 1,
		outcome_id: randomUUID(),
		observed_at: new Date().toISOString(),
		label: label_outcome(input.evidence),
	};
}
function comparable_outcome(outcome: ObservedOutcome): boolean {
	const correlation = outcome.correlation;
	return Boolean(
		outcome.provenance &&
		outcome.provenance.kind !== 'synthetic' &&
		correlation?.status === 'measured' &&
		correlation.provider &&
		correlation.model &&
		correlation.reasoning &&
		correlation.session_id &&
		(correlation.telemetry_run_id ||
			correlation.observability_session_id ||
			(outcome.tokens !== undefined && outcome.tokens > 0) ||
			(outcome.cost_usd !== undefined && outcome.cost_usd > 0)) &&
		typeof correlation.duration_ms === 'number' &&
		Number.isFinite(correlation.duration_ms) &&
		correlation.duration_ms >= 0 &&
		correlation.terminal_outcome &&
		(correlation.terminal_outcome !== 'completed' ||
			correlation.authoritative_delivery === true),
	);
}

export function derive_calibration_report(
	cases: CalibrationCase[],
	outcomes: ObservedOutcome[],
	derivation_version = '1',
	thresholds: CalibrationThresholds = DEFAULT_CALIBRATION_THRESHOLDS,
): CalibrationReport {
	if (
		thresholds.minimum_sample_size < 1 ||
		thresholds.low_confidence_sample_size <
			thresholds.minimum_sample_size ||
		thresholds.medium_confidence_sample_size <
			thresholds.low_confidence_sample_size ||
		thresholds.maximum_missing_rate < 0 ||
		thresholds.maximum_missing_rate > 1
	)
		throw new Error('Invalid calibration thresholds');
	const by_case = new Map<string, CalibrationCase>();
	for (const calibration_case of cases) {
		if (calibration_case.schema_version !== 1)
			throw new Error('Unsupported calibration case schema');
		if (by_case.has(calibration_case.case_id))
			throw new Error(
				`Duplicate calibration case id ${calibration_case.case_id}`,
			);
		if (
			!Number.isInteger(calibration_case.retry_limit) ||
			calibration_case.retry_limit < 0 ||
			!Number.isInteger(calibration_case.stall_timeout_ms) ||
			calibration_case.stall_timeout_ms < 1 ||
			!Number.isInteger(calibration_case.max_parallelism) ||
			calibration_case.max_parallelism < 1
		)
			throw new Error(
				`Calibration case ${calibration_case.case_id} has invalid numeric pins`,
			);
		by_case.set(calibration_case.case_id, calibration_case);
	}
	const outcome_ids = new Set<string>();
	for (const outcome of outcomes) {
		if (outcome.schema_version !== 1)
			throw new Error('Unsupported observed outcome schema');
		if (outcome_ids.has(outcome.outcome_id))
			throw new Error(`Duplicate outcome id ${outcome.outcome_id}`);
		outcome_ids.add(outcome.outcome_id);
		const calibration_case = by_case.get(outcome.case_id);
		if (
			!calibration_case ||
			calibration_case.case_version !== outcome.case_version
		)
			throw new Error(
				`Outcome ${outcome.outcome_id} references an incompatible case`,
			);
		if (outcome.label !== label_outcome(outcome.evidence))
			throw new Error(
				`Outcome ${outcome.outcome_id} label is not reproducible from evidence`,
			);
	}
	const groups = new Map<
		string,
		{ calibration_case: CalibrationCase; outcomes: ObservedOutcome[] }
	>();
	for (const calibration_case of cases) {
		const key = sha({
			workflow: calibration_case.workflow,
			workflow_version: calibration_case.workflow_version,
			policy_id: calibration_case.policy_id,
			policy_hash: calibration_case.policy_hash,
			route_fingerprint: calibration_case.route_fingerprint,
			compute_fingerprint: calibration_case.compute_fingerprint,
			gate_fingerprint: calibration_case.gate_fingerprint,
			project_revision: calibration_case.project_revision,
			repository_shape: calibration_case.repository_shape,
			risk: calibration_case.risk,
			retry_limit: calibration_case.retry_limit,
			stall_timeout_ms: calibration_case.stall_timeout_ms,
			max_parallelism: calibration_case.max_parallelism,
			cohort: calibration_case.cohort,
			experiment_id: calibration_case.experiment_id ?? 'default',
			evolution_version_id:
				calibration_case.evolution_version_id ?? 'none',
		});
		const group = groups.get(key) ?? {
			calibration_case,
			outcomes: [],
		};
		group.outcomes.push(
			...outcomes.filter(
				(outcome) => outcome.case_id === calibration_case.case_id,
			),
		);
		groups.set(key, group);
	}
	const cohorts = [...groups.entries()]
		.map(([key, group]) => {
			const labels: Partial<Record<OutcomeLabel, number>> = {};
			for (const outcome of group.outcomes)
				labels[outcome.label] = (labels[outcome.label] ?? 0) + 1;
			const warnings: string[] = [];
			if (group.outcomes.length < thresholds.minimum_sample_size)
				warnings.push(
					'Sparse sample: no comparative policy conclusion is permitted',
				);
			if (group.outcomes.some((item) => item.label === 'incomplete'))
				warnings.push(
					'Incomplete runs are excluded from success denominators',
				);
			if (
				group.outcomes.some(
					(item) => item.label === 'conflicting-evidence',
				)
			)
				warnings.push('Conflicting evidence requires adjudication');
			const comparable = group.outcomes.filter(comparable_outcome);
			const excluded_runs = group.outcomes.length - comparable.length;
			if (excluded_runs)
				warnings.push(
					`${excluded_runs} run(s) excluded: missing measured correlation, authoritative terminal delivery, or non-synthetic evidence`,
				);
			const complete = comparable.filter(
				(item) =>
					!['incomplete', 'conflicting-evidence'].includes(
						item.label,
					),
			);
			const metrics = [
				rate(
					'success_rate',
					complete.map((item) => item.label === 'success'),
					thresholds,
				),
				rate(
					'first_pass_success_rate',
					complete.map((item) => item.first_pass),
					thresholds,
				),
				average(
					'retries',
					complete.map((item) => item.retries),
					thresholds,
				),
				rate(
					'rework_rate',
					complete.map((item) => item.rework),
					thresholds,
				),
				rate(
					'interruption_rate',
					complete.map((item) => item.interrupted),
					thresholds,
				),
				rate(
					'escalation_rate',
					complete.map((item) => item.escalated),
					thresholds,
				),
				average(
					'lead_time_ms',
					complete.map((item) => item.lead_time_ms),
					thresholds,
				),
				average(
					'approval_wait_ms',
					complete.map((item) => item.approval_wait_ms),
					thresholds,
				),
				average(
					'tokens',
					complete.map((item) => item.tokens),
					thresholds,
				),
				average(
					'cost_usd',
					complete.map((item) => item.cost_usd),
					thresholds,
				),
			];
			for (const metric of metrics)
				if (
					metric.value === null ||
					(metric.denominator > 0 &&
						metric.missing / (metric.denominator + metric.missing) >
							thresholds.maximum_missing_rate)
				)
					warnings.push(
						`Missing metric evidence for ${metric.name} blocks comparison`,
					);
			const project_ids = [
				...new Set(
					group.outcomes
						.map(
							(outcome) => by_case.get(outcome.case_id)?.project_id,
						)
						.filter((item): item is string => Boolean(item)),
				),
			].sort();
			if (project_ids.length < 2)
				warnings.push(
					'Project-specific evidence: do not generalize without compatible multi-project support',
				);
			return {
				key,
				workflow: group.calibration_case.workflow,
				workflow_version: group.calibration_case.workflow_version,
				policy_id: group.calibration_case.policy_id,
				cohort: group.calibration_case.cohort,
				pins: {
					case_version: group.calibration_case.case_version,
					risk: group.calibration_case.risk,
					repository_shape: group.calibration_case.repository_shape,
					project_revision: group.calibration_case.project_revision,
					policy_hash: group.calibration_case.policy_hash,
					route_fingerprint: group.calibration_case.route_fingerprint,
					compute_fingerprint:
						group.calibration_case.compute_fingerprint,
					gate_fingerprint: group.calibration_case.gate_fingerprint,
					retry_limit: group.calibration_case.retry_limit,
					stall_timeout_ms: group.calibration_case.stall_timeout_ms,
					max_parallelism: group.calibration_case.max_parallelism,
					experiment_id: group.calibration_case.experiment_id,
					evolution_version_id:
						group.calibration_case.evolution_version_id,
				},
				runs: group.outcomes.length,
				excluded_runs,
				labels,
				metrics,
				warnings,
				finding_scope:
					project_ids.length > 1
						? ('general' as const)
						: ('project-specific' as const),
				project_ids,
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
	const case_ids = cases.map((item) => item.case_id).sort();
	const observed_outcome_ids = outcomes
		.map((item) => item.outcome_id)
		.sort();
	const identity = {
		derivation_version,
		thresholds,
		cases: [...cases].sort((a, b) =>
			a.case_id.localeCompare(b.case_id),
		),
		outcomes: [...outcomes].sort((a, b) =>
			a.outcome_id.localeCompare(b.outcome_id),
		),
		cohorts,
	};
	return {
		schema_version: 1,
		report_id: randomUUID(),
		derivation_version,
		created_at: new Date().toISOString(),
		thresholds: { ...thresholds },
		case_ids,
		outcome_ids: observed_outcome_ids,
		cohorts,
		fingerprint: sha(identity),
	};
}
export function compare_calibration_cohorts(
	report: CalibrationReport,
	production_key: string,
	experimental_key: string,
): {
	comparable: boolean;
	deltas: Record<string, number>;
	warnings: string[];
} {
	const production = report.cohorts.find(
		(item) => item.key === production_key,
	);
	const experimental = report.cohorts.find(
		(item) => item.key === experimental_key,
	);
	if (!production || !experimental)
		throw new Error('Calibration cohort is missing');
	if (
		production.workflow !== experimental.workflow ||
		production.workflow_version !== experimental.workflow_version
	)
		throw new Error('Mixed workflow versions cannot be compared');
	if (
		production.cohort !== 'production' ||
		experimental.cohort !== 'experimental'
	)
		throw new Error(
			'Calibration comparison requires production then experimental cohorts',
		);
	const warnings = [...production.warnings, ...experimental.warnings];
	if (production.excluded_runs || experimental.excluded_runs)
		warnings.push(
			'Excluded uncorrelated or synthetic runs block comparison and recommendations',
		);
	for (const field of [
		'case_version',
		'risk',
		'repository_shape',
		'project_revision',
	] as const)
		if (production.pins[field] !== experimental.pins[field])
			warnings.push(
				`Incompatible calibration pin ${field}: ${String(production.pins[field])} != ${String(experimental.pins[field])}`,
			);
	if (!experimental.pins.experiment_id)
		warnings.push('Experimental cohort is missing an experiment id');
	for (const metric_name of [
		'success_rate',
		'first_pass_success_rate',
		'retries',
		'rework_rate',
		'interruption_rate',
		'escalation_rate',
		'lead_time_ms',
		'approval_wait_ms',
		'tokens',
		'cost_usd',
	])
		if (
			!production.metrics.some((item) => item.name === metric_name) ||
			!experimental.metrics.some((item) => item.name === metric_name)
		)
			warnings.push(
				`Missing metric evidence for ${metric_name} blocks comparison`,
			);
	if (
		production.metrics.some(
			(metric) =>
				metric.value !== null &&
				(metric.confidence === 'insufficient' || metric.missing > 0),
		) ||
		experimental.metrics.some(
			(metric) =>
				metric.value !== null &&
				(metric.confidence === 'insufficient' || metric.missing > 0),
		)
	)
		warnings.push(
			'Insufficient confidence or missing metric evidence blocks comparison',
		);
	const deltas: Record<string, number> = {};
	for (const metric of production.metrics) {
		const other = experimental.metrics.find(
			(item) => item.name === metric.name,
		);
		if (
			metric.value !== null &&
			other?.value !== null &&
			other?.value !== undefined
		)
			deltas[metric.name] = other.value - metric.value;
	}
	return {
		comparable: !warnings.some((item) => {
			const normalized = item.toLowerCase();
			return (
				normalized.startsWith('sparse') ||
				normalized.includes('conflicting') ||
				normalized.includes('insufficient') ||
				normalized.includes('incomplete') ||
				normalized.includes('missing') ||
				normalized.includes('excluded') ||
				normalized.includes('incompatible')
			);
		}),
		deltas,
		warnings,
	};
}
