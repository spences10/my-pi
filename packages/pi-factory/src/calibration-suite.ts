import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	compare_calibration_cohorts,
	create_observed_outcome,
	DEFAULT_CALIBRATION_THRESHOLDS,
	derive_calibration_report,
	is_comparable_outcome,
	type CalibrationCase,
	type CalibrationReport,
	type CalibrationThresholds,
	type ObservedOutcome,
	type OutcomeEvidence,
	type OutcomeLabel,
} from './calibration.js';
import { get_workflow } from './catalog.js';
import type { DogfoodBaselineResult } from './dogfood.js';
import { has_complete_execution_correlation } from './metrics.js';
import type { FactoryState, WorkflowKind } from './types.js';

const workflow_kinds: WorkflowKind[] = [
	'chore',
	'feature',
	'ambiguous-bug',
	'ui-copy',
	'database-migration',
	'incident',
	'architecture',
	'safe-release',
];

export interface CalibrationProject {
	project_id: string;
	repository_shape: string;
	project_revision: string;
	policy_id: string;
	policy_hash: string;
}
export interface CalibrationComputeTarget {
	provider: string;
	model: string;
	reasoning: string;
	cohort: 'production' | 'experimental';
	experiment_id?: string;
}
export interface CalibrationSuite {
	schema_version: 1;
	suite_id: string;
	suite_version: string;
	created_at: string;
	projects: CalibrationProject[];
	cases: CalibrationCase[];
	thresholds: CalibrationThresholds;
	dogfood: DogfoodBaselineResult[];
}
export interface ProposedCalibrationExperiment {
	experiment_id: string;
	suite_id: string;
	suite_version: string;
	workflow: WorkflowKind;
	kind: 'collect-evidence' | 'controlled-compute-comparison';
	rationale: string;
	status: 'proposed';
	mutates_policy: false;
}
export interface CalibrationSuiteEvaluation {
	schema_version: 1;
	suite_id: string;
	suite_version: string;
	evaluated_at: string;
	report: CalibrationReport;
	baseline_status: 'valid' | 'blocked';
	blocking_reasons: string[];
	/** Complete, comparable measured outcomes accepted for thresholds. */
	workflow_coverage: Record<WorkflowKind, number>;
	/** All rows associated with a suite case, including excluded rows. */
	workflow_total: Record<WorkflowKind, number>;
	/** Associated rows rejected by provenance or correlation checks. */
	workflow_excluded: Record<WorkflowKind, number>;
	regressions: string[];
	bias_warnings: string[];
	fingerprint: string;
}

function sha(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex');
}

export function define_factory_calibration_suite(input: {
	suite_id: string;
	suite_version: string;
	projects: CalibrationProject[];
	compute_targets: CalibrationComputeTarget[];
	thresholds?: CalibrationThresholds;
	dogfood: DogfoodBaselineResult[];
}): CalibrationSuite {
	if (!input.compute_targets.length)
		throw new Error('Calibration suite requires compute targets');
	const cases: CalibrationCase[] = [];
	for (const project of input.projects)
		for (const workflow_kind of workflow_kinds)
			for (const [
				index,
				compute,
			] of input.compute_targets.entries()) {
				const workflow = get_workflow(workflow_kind);
				cases.push({
					schema_version: 1,
					case_id: `${input.suite_id}:${input.suite_version}:${project.project_id}:${workflow_kind}:${index}`,
					case_version: '1',
					workflow: workflow_kind,
					workflow_version: workflow.version,
					risk: workflow.risk,
					repository_shape: project.repository_shape,
					project_revision: project.project_revision,
					policy_id: project.policy_id,
					policy_hash: project.policy_hash,
					route_fingerprint: sha({
						workflow: workflow_kind,
						version: workflow.version,
						project_revision: project.project_revision,
						policy_hash: project.policy_hash,
					}),
					compute_fingerprint: sha({
						provider: compute.provider,
						model: compute.model,
						reasoning: compute.reasoning,
						parallelism: workflow.compute.parallelism,
					}),
					gate_fingerprint: sha(workflow.validations),
					retry_limit: Math.max(
						...workflow.nodes.map((node) => node.retry_limit),
					),
					stall_timeout_ms: workflow.stall_timeout_ms,
					max_parallelism: workflow.compute.parallelism,
					cohort: compute.cohort,
					experiment_id: compute.experiment_id,
					suite_id: input.suite_id,
					suite_version: input.suite_version,
					project_id: project.project_id,
					provider: compute.provider,
					model: compute.model,
					reasoning: compute.reasoning,
				});
			}
	return create_calibration_suite({ ...input, cases });
}

export function create_calibration_suite(input: {
	suite_id: string;
	suite_version: string;
	projects: CalibrationProject[];
	cases: CalibrationCase[];
	thresholds?: CalibrationThresholds;
	dogfood: DogfoodBaselineResult[];
}): CalibrationSuite {
	if (!input.suite_id || !input.suite_version)
		throw new Error('Calibration suite requires id and version');
	if (!input.projects.length)
		throw new Error('Calibration suite requires projects');
	for (const workflow of workflow_kinds)
		if (!input.cases.some((item) => item.workflow === workflow))
			throw new Error(
				`Calibration suite is missing workflow ${workflow}`,
			);
	for (const calibration_case of input.cases) {
		if (
			calibration_case.suite_id !== input.suite_id ||
			calibration_case.suite_version !== input.suite_version ||
			!calibration_case.project_id ||
			!calibration_case.provider ||
			!calibration_case.model ||
			!calibration_case.reasoning
		)
			throw new Error(
				`Calibration case ${calibration_case.case_id} is missing suite/project/compute pins`,
			);
		const project = input.projects.find(
			(item) => item.project_id === calibration_case.project_id,
		);
		if (
			!project ||
			project.repository_shape !==
				calibration_case.repository_shape ||
			project.project_revision !==
				calibration_case.project_revision ||
			project.policy_id !== calibration_case.policy_id ||
			project.policy_hash !== calibration_case.policy_hash
		)
			throw new Error(
				`Calibration case ${calibration_case.case_id} has incompatible project pins`,
			);
	}
	if (
		input.dogfood.some(
			(item) => item.eligible_for_comparison !== false,
		)
	)
		throw new Error(
			'Synthetic dogfood cannot be promoted to calibration evidence',
		);
	return {
		schema_version: 1,
		suite_id: input.suite_id,
		suite_version: input.suite_version,
		created_at: new Date().toISOString(),
		projects: structuredClone(input.projects),
		cases: structuredClone(input.cases),
		thresholds: structuredClone(
			input.thresholds ?? DEFAULT_CALIBRATION_THRESHOLDS,
		),
		dogfood: structuredClone(input.dogfood),
	};
}

export interface FactoryOutcomeImportProvenance {
	/** The embedding application authenticated this complete pin envelope. */
	authentication: 'embedding-application';
	authenticated_actor: string;
	source_id: string;
	suite_id: string;
	suite_version: string;
	case_id: string;
	case_version: string;
	project_id: string;
	project_revision: string;
	repository_shape: string;
	policy_id: string;
	policy_hash: string;
}

const failure_label: Record<string, OutcomeLabel> = {
	'workflow-failure': 'workflow-policy-defect',
	'executor-failure': 'executor-defect',
	'operator-misuse': 'operator-defect',
	'project-policy-failure': 'repository-policy-defect',
	'validation-failure': 'executor-defect',
	'platform-failure': 'platform-failure',
};

export function import_factory_outcome(
	state: FactoryState,
	calibration_case: CalibrationCase,
	provenance?: FactoryOutcomeImportProvenance,
): ObservedOutcome {
	const lifecycle = state.events.filter(
		(event) =>
			event.type === 'execution.lifecycle' &&
			event.metadata?.contract_version === state.contract_version,
	);
	const durable_correlation = has_complete_execution_correlation(
		state,
		false,
	);
	const correlation_event = lifecycle.find(
		(event) => event.metadata?.read_only === false,
	);
	const provider = correlation_event?.metadata?.provider as
		| string
		| undefined;
	const model = correlation_event?.metadata?.model as
		| string
		| undefined;
	const reasoning = correlation_event?.metadata?.reasoning as
		| string
		| undefined;
	const authenticated_pins = Boolean(
		provenance?.authentication === 'embedding-application' &&
		typeof provenance.authenticated_actor === 'string' &&
		provenance.authenticated_actor.trim() &&
		provenance.source_id === state.workflow_id &&
		provenance.suite_id === calibration_case.suite_id &&
		provenance.suite_version === calibration_case.suite_version &&
		provenance.case_id === calibration_case.case_id &&
		provenance.case_version === calibration_case.case_version &&
		provenance.project_id === calibration_case.project_id &&
		provenance.project_id === state.route.workspace.id &&
		provenance.project_revision ===
			calibration_case.project_revision &&
		provenance.repository_shape ===
			calibration_case.repository_shape &&
		provenance.policy_id === calibration_case.policy_id &&
		provenance.policy_id === state.route.policy_id &&
		provenance.policy_hash === calibration_case.policy_hash,
	);
	const route_pin = sha({
		workflow: state.route.workflow.id,
		version: state.route.workflow.version,
		project_revision: provenance?.project_revision,
		policy_hash: provenance?.policy_hash,
	});
	const gate_pin = sha(state.route.workflow.validations);
	const compute_pin = sha({
		provider,
		model,
		reasoning,
		parallelism: state.route.workflow.compute.parallelism,
	});
	const durable_pins =
		calibration_case.project_id === state.route.workspace.id &&
		calibration_case.workflow === state.route.workflow.id &&
		calibration_case.workflow_version ===
			state.route.workflow.version &&
		calibration_case.policy_id === state.route.policy_id &&
		calibration_case.risk === state.route.workflow.risk &&
		calibration_case.route_fingerprint === route_pin &&
		calibration_case.gate_fingerprint === gate_pin &&
		calibration_case.compute_fingerprint === compute_pin &&
		calibration_case.provider === provider &&
		calibration_case.model === model &&
		calibration_case.reasoning === reasoning &&
		calibration_case.max_parallelism ===
			state.route.workflow.compute.parallelism &&
		calibration_case.stall_timeout_ms ===
			state.route.workflow.stall_timeout_ms &&
		calibration_case.retry_limit ===
			Math.max(
				...state.route.workflow.nodes.map((node) => node.retry_limit),
			);
	const complete_correlation =
		durable_correlation && authenticated_pins && durable_pins;
	const evidence: OutcomeEvidence[] = [];
	for (const event of state.events.filter(
		(item) => item.type === 'failure.classified',
	)) {
		const label =
			failure_label[String(event.metadata?.classification)];
		if (label)
			evidence.push({
				id: event.id,
				kind: 'event',
				label,
				complete: complete_correlation,
			});
	}
	if (
		state.outcome?.status === 'completed' &&
		state.outcome.authoritative
	)
		evidence.push({
			id: `outcome:${state.workflow_id}`,
			kind: 'validation',
			label: 'success',
			complete: complete_correlation,
		});
	else if (state.outcome?.status === 'completed-outside-factory')
		evidence.push({
			id: `outside:${state.workflow_id}`,
			kind: 'event',
			label: 'external-failure',
			complete: false,
		});
	else if (state.outcome?.classification)
		evidence.push({
			id: `outcome:${state.workflow_id}`,
			kind: 'event',
			label: failure_label[state.outcome.classification],
			complete: complete_correlation,
		});
	if (!evidence.length)
		evidence.push({
			id: `incomplete:${state.workflow_id}`,
			kind: 'event',
			complete: false,
		});
	return create_observed_outcome({
		case_id: calibration_case.case_id,
		provenance: {
			kind: provenance ? 'authenticated-import' : 'factory-state',
			source_id: state.workflow_id,
			authentication: provenance?.authentication,
			authenticated_actor: provenance?.authenticated_actor,
			suite_id: provenance?.suite_id,
			suite_version: provenance?.suite_version,
			case_id: provenance?.case_id,
			case_version: provenance?.case_version,
			project_id: state.route.workspace.id,
			project_revision: provenance?.project_revision,
			repository_shape: provenance?.repository_shape,
			policy_id: state.route.policy_id,
			policy_hash: provenance?.policy_hash,
			workflow: state.route.workflow.id,
			workflow_version: state.route.workflow.version,
			route_fingerprint: route_pin,
			compute_fingerprint: compute_pin,
			gate_fingerprint: gate_pin,
		},
		case_version: calibration_case.case_version,
		workflow_id: state.workflow_id,
		evidence,
		correlation: {
			status: complete_correlation ? 'measured' : 'uncorrelated',
			provider,
			model,
			reasoning,
			session_id: correlation_event?.session_id,
			telemetry_run_id: correlation_event?.telemetry_run_id,
			observability_session_id:
				correlation_event?.observability_session_id,
			terminal_outcome: state.outcome?.status,
			authoritative_delivery:
				state.outcome?.status === 'completed' &&
				state.outcome.authoritative,
			duration_ms: lifecycle.reduce(
				(total, event) => total + (event.duration_ms ?? 0),
				0,
			),
		},
		first_pass:
			state.outcome?.status === 'completed' &&
			!state.nodes.some((node) => node.attempts > 1),
		retries: state.nodes.reduce(
			(total, node) => total + Math.max(0, node.attempts - 1),
			0,
		),
		rework: state.contract_version > 1,
		lead_time_ms: Math.max(
			0,
			Date.parse(state.updated_at) - Date.parse(state.created_at),
		),
		approval_wait_ms: state.events
			.filter((event) => event.type === 'approval.granted')
			.reduce((total, event) => total + (event.duration_ms ?? 0), 0),
		tokens: lifecycle.reduce(
			(total, event) => total + (event.tokens ?? 0),
			0,
		),
		cost_usd: lifecycle.reduce(
			(total, event) => total + (event.cost_usd ?? 0),
			0,
		),
		interrupted: state.events.some((event) =>
			['ownership.stalled', 'workflow.resumed'].includes(event.type),
		),
		escalated: state.events.some(
			(event) => event.type === 'node.escalated',
		),
	});
}

export function evaluate_calibration_suite(
	suite: CalibrationSuite,
	outcomes: ObservedOutcome[],
): CalibrationSuiteEvaluation {
	const reviewed_outcomes = outcomes.map((outcome) => {
		const calibration_case = suite.cases.find(
			(item) => item.case_id === outcome.case_id,
		);
		const provenance = outcome.provenance;
		if (
			!calibration_case ||
			!provenance ||
			provenance.kind === 'synthetic' ||
			provenance.source_id !== outcome.workflow_id ||
			(provenance.kind === 'authenticated-import' &&
				(provenance.authentication !== 'embedding-application' ||
					!provenance.authenticated_actor?.trim())) ||
			provenance.suite_id !== suite.suite_id ||
			provenance.suite_version !== suite.suite_version ||
			provenance.case_id !== calibration_case.case_id ||
			provenance.case_version !== calibration_case.case_version ||
			provenance.project_id !== calibration_case.project_id ||
			provenance.project_revision !==
				calibration_case.project_revision ||
			provenance.repository_shape !==
				calibration_case.repository_shape ||
			provenance.policy_id !== calibration_case.policy_id ||
			provenance.policy_hash !== calibration_case.policy_hash ||
			provenance.workflow !== calibration_case.workflow ||
			provenance.workflow_version !==
				calibration_case.workflow_version ||
			provenance.route_fingerprint !==
				calibration_case.route_fingerprint ||
			provenance.compute_fingerprint !==
				calibration_case.compute_fingerprint ||
			provenance.gate_fingerprint !==
				calibration_case.gate_fingerprint
		)
			return {
				...outcome,
				correlation: {
					...(outcome.correlation ?? {
						status: 'uncorrelated' as const,
					}),
					status: 'uncorrelated' as const,
				},
			};
		return outcome;
	});
	const report = derive_calibration_report(
		suite.cases,
		reviewed_outcomes,
		`${suite.suite_id}@${suite.suite_version}`,
		suite.thresholds,
	);
	const workflow_total = Object.fromEntries(
		workflow_kinds.map((workflow) => [
			workflow,
			reviewed_outcomes.filter((outcome) =>
				suite.cases.some(
					(item) =>
						item.case_id === outcome.case_id &&
						item.workflow === workflow,
				),
			).length,
		]),
	) as Record<WorkflowKind, number>;
	const workflow_coverage = Object.fromEntries(
		workflow_kinds.map((workflow) => [
			workflow,
			reviewed_outcomes.filter(
				(outcome) =>
					is_comparable_outcome(outcome) &&
					suite.cases.some(
						(item) =>
							item.case_id === outcome.case_id &&
							item.workflow === workflow,
					),
			).length,
		]),
	) as Record<WorkflowKind, number>;
	const workflow_excluded = Object.fromEntries(
		workflow_kinds.map((workflow) => [
			workflow,
			workflow_total[workflow] - workflow_coverage[workflow],
		]),
	) as Record<WorkflowKind, number>;
	const blocking_reasons = report.cohorts.flatMap((cohort) =>
		cohort.warnings
			.filter((warning) =>
				/(sparse|missing|excluded|incomplete|conflicting|incompatible)/i.test(
					warning,
				),
			)
			.map((warning) => `${cohort.key}: ${warning}`),
	);
	for (const workflow of workflow_kinds)
		if (
			workflow_coverage[workflow] <
			suite.thresholds.minimum_sample_size
		)
			blocking_reasons.push(
				`${workflow}: insufficient measured sample coverage`,
			);
	if (
		suite.dogfood.some(
			(item) => item.eligible_for_comparison !== false,
		)
	)
		blocking_reasons.push('Synthetic dogfood promotion detected');
	const bias_warnings = report.cohorts
		.filter((cohort) => cohort.finding_scope === 'project-specific')
		.map(
			(cohort) =>
				`${cohort.key}: project concentration bias; findings are project-specific`,
		);
	const regressions: string[] = [];
	for (const production of report.cohorts.filter(
		(item) => item.cohort === 'production',
	))
		for (const experimental of report.cohorts.filter(
			(item) =>
				item.cohort === 'experimental' &&
				item.workflow === production.workflow &&
				item.workflow_version === production.workflow_version,
		)) {
			const comparison = compare_calibration_cohorts(
				report,
				production.key,
				experimental.key,
			);
			if (!comparison.comparable) continue;
			for (const [metric, delta] of Object.entries(comparison.deltas))
				if (
					(['success_rate', 'first_pass_success_rate'].includes(
						metric,
					) &&
						delta < 0) ||
					(!['success_rate', 'first_pass_success_rate'].includes(
						metric,
					) &&
						delta > 0)
				)
					regressions.push(
						`${production.workflow}:${metric}:${delta}`,
					);
		}
	const identity = {
		suite_id: suite.suite_id,
		suite_version: suite.suite_version,
		case_ids: report.case_ids,
		outcome_ids: report.outcome_ids,
		report_fingerprint: report.fingerprint,
		thresholds: suite.thresholds,
		blocking_reasons: [...blocking_reasons].sort(),
		regressions: [...regressions].sort(),
		bias_warnings: [...bias_warnings].sort(),
	};
	return {
		schema_version: 1,
		suite_id: suite.suite_id,
		suite_version: suite.suite_version,
		evaluated_at: new Date().toISOString(),
		report,
		baseline_status: blocking_reasons.length ? 'blocked' : 'valid',
		blocking_reasons: [...blocking_reasons].sort(),
		workflow_coverage,
		workflow_total,
		workflow_excluded,
		regressions: [...regressions].sort(),
		bias_warnings: [...bias_warnings].sort(),
		fingerprint: sha(identity),
	};
}

export function propose_calibration_experiments(
	suite: CalibrationSuite,
	evaluation: CalibrationSuiteEvaluation,
): ProposedCalibrationExperiment[] {
	if (
		evaluation.suite_id !== suite.suite_id ||
		evaluation.suite_version !== suite.suite_version
	)
		throw new Error(
			'Evaluation does not belong to calibration suite version',
		);
	const proposals: ProposedCalibrationExperiment[] = [];
	for (const workflow of workflow_kinds) {
		const missing = Math.max(
			0,
			suite.thresholds.minimum_sample_size -
				evaluation.workflow_coverage[workflow],
		);
		if (missing)
			proposals.push({
				experiment_id: randomUUID(),
				suite_id: suite.suite_id,
				suite_version: suite.suite_version,
				workflow,
				kind: 'collect-evidence',
				rationale: `Collect ${missing} additional authoritative correlated outcome(s)`,
				status: 'proposed',
				mutates_policy: false,
			});
	}
	for (const regression of evaluation.regressions) {
		const workflow = regression.split(':')[0] as WorkflowKind;
		proposals.push({
			experiment_id: randomUUID(),
			suite_id: suite.suite_id,
			suite_version: suite.suite_version,
			workflow,
			kind: 'controlled-compute-comparison',
			rationale: `Investigate measured regression without changing active policy: ${regression}`,
			status: 'proposed',
			mutates_policy: false,
		});
	}
	return proposals;
}

interface CalibrationLedger {
	schema_version: 1;
	suites: CalibrationSuite[];
	outcomes: ObservedOutcome[];
	evaluations: CalibrationSuiteEvaluation[];
}

export class CalibrationSuiteStore {
	readonly path: string;
	constructor(path: string) {
		this.path = resolve(path);
	}
	private load(): CalibrationLedger {
		if (!existsSync(this.path))
			return {
				schema_version: 1,
				suites: [],
				outcomes: [],
				evaluations: [],
			};
		const value = JSON.parse(
			readFileSync(this.path, 'utf8'),
		) as CalibrationLedger;
		if (value.schema_version !== 1)
			throw new Error('Unsupported calibration ledger');
		return value;
	}
	private save(value: CalibrationLedger): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: 'wx',
			mode: 0o600,
		});
		renameSync(temporary, this.path);
	}
	put_suite(suite: CalibrationSuite): void {
		const ledger = this.load();
		if (
			ledger.suites.some(
				(item) =>
					item.suite_id === suite.suite_id &&
					item.suite_version === suite.suite_version,
			)
		)
			throw new Error('Calibration suite version already exists');
		ledger.suites.push(structuredClone(suite));
		this.save(ledger);
	}
	put_outcomes(outcomes: ObservedOutcome[]): void {
		const ledger = this.load();
		const ids = new Set(
			ledger.outcomes.map((item) => item.outcome_id),
		);
		for (const outcome of outcomes) {
			if (ids.has(outcome.outcome_id))
				throw new Error('Duplicate calibration outcome');
			ids.add(outcome.outcome_id);
			ledger.outcomes.push(structuredClone(outcome));
		}
		this.save(ledger);
	}
	put_evaluation(evaluation: CalibrationSuiteEvaluation): void {
		const ledger = this.load();
		ledger.evaluations.push(structuredClone(evaluation));
		this.save(ledger);
	}
	query(
		input: {
			suite_id?: string;
			suite_version?: string;
			workflow?: WorkflowKind;
			project_id?: string;
		} = {},
	): CalibrationLedger {
		const ledger = this.load();
		const cases = ledger.suites
			.filter(
				(suite) =>
					(!input.suite_id || suite.suite_id === input.suite_id) &&
					(!input.suite_version ||
						suite.suite_version === input.suite_version),
			)
			.flatMap((suite) => suite.cases)
			.filter(
				(item) =>
					(!input.workflow || item.workflow === input.workflow) &&
					(!input.project_id || item.project_id === input.project_id),
			);
		const case_ids = new Set(cases.map((item) => item.case_id));
		return {
			schema_version: 1,
			suites: ledger.suites.filter((suite) =>
				suite.cases.some((item) => case_ids.has(item.case_id)),
			),
			outcomes: ledger.outcomes.filter((item) =>
				case_ids.has(item.case_id),
			),
			evaluations: ledger.evaluations.filter(
				(item) =>
					(!input.suite_id || item.suite_id === input.suite_id) &&
					(!input.suite_version ||
						item.suite_version === input.suite_version),
			),
		};
	}
	export_json(
		input: Parameters<CalibrationSuiteStore['query']>[0] = {},
	): string {
		return `${JSON.stringify(this.query(input), null, 2)}\n`;
	}
}
