import { Type, type Static } from 'typebox';
import { harness_create_params_schema } from './schema.js';

export const HARNESS_ASSESSMENT_CUSTOM_TYPE =
	'pi-harness-assessment-state';
export const harness_assess_params_schema = Type.Object({
	task: Type.String({
		minLength: 1,
		description:
			'Optional investigation before choosing an execution path',
	}),
});
export const harness_assessment_submit_params_schema = Type.Object({
	task: Type.String(),
	evidence: Type.Array(Type.String()),
	existing_primitives: Type.Array(Type.String()),
	rejected_options: Type.Array(Type.String()),
	smallest_vertical_slice: Type.String(),
	recommendation: Type.Union([
		Type.Literal('harness'),
		Type.Literal('direct'),
		Type.Literal('reject'),
	]),
	proposed_contract: Type.Optional(harness_create_params_schema),
});
export type HarnessAssessParams = Static<
	typeof harness_assess_params_schema
>;
export type HarnessAssessmentRecord = Static<
	typeof harness_assessment_submit_params_schema
>;
export type HarnessAssessmentRecommendation =
	HarnessAssessmentRecord['recommendation'];
export type HarnessAssessmentSource =
	| 'agent'
	| 'user'
	| 'harness-create';
export type HarnessAssessmentStatus =
	| 'assessing'
	| 'assessed'
	| 'awaiting_approval'
	| 'approved'
	| 'rejected';
export interface HarnessAssessmentState {
	id: string;
	version: number;
	status: HarnessAssessmentStatus;
	task: string;
	source: HarnessAssessmentSource;
	started_at: string;
	tools_before_assessment?: string[];
	record?: HarnessAssessmentRecord;
	decision?: HarnessAssessmentRecommendation;
}

export function create_assessment_state(
	task: string,
	source: HarnessAssessmentSource,
	tools_before_assessment: string[] = [],
	now = new Date(),
): HarnessAssessmentState {
	if (!task.trim()) throw new Error('Assessment task is required');
	return {
		id: `assessment-${now.getTime().toString(36)}`,
		version: 1,
		status: 'assessing',
		task: task.trim(),
		source,
		started_at: now.toISOString(),
		tools_before_assessment,
	};
}

export function submit_assessment_record(
	state: HarnessAssessmentState,
	record: HarnessAssessmentRecord,
): HarnessAssessmentState {
	return {
		...state,
		version: state.version + 1,
		status: 'assessed',
		task: record.task.trim(),
		record,
	};
}

export function assessment_active(
	state: HarnessAssessmentState | undefined,
): boolean {
	return state?.status === 'assessing';
}

export function assessment_context(
	state: HarnessAssessmentState,
): string {
	return `## Optional harness assessment\n\nTask: ${state.task}\n\nInvestigate the need, existing primitives, and smallest useful change before recommending an execution path. This is advisory planning, not a read-only security mode: tools remain available and normal user authorization still applies. Submit findings with harness_assessment_submit. Assessment is not required to create a harness.`;
}

export function format_assessment_record(
	state: HarnessAssessmentState,
): string {
	const record = state.record;
	if (!record) return `Assessment ${state.id}: ${state.task}`;
	const list = (values: string[]) =>
		values.map((value) => `- ${value}`).join('\n') ||
		'- None recorded';
	return `# Harness assessment\n\n${record.task}\n\nRecommendation: ${record.recommendation}\n\n## Evidence\n\n${list(record.evidence)}\n\n## Existing primitives\n\n${list(record.existing_primitives)}\n\n## Rejected options\n\n${list(record.rejected_options)}\n\n## Smallest vertical slice\n\n${record.smallest_vertical_slice}`;
}
