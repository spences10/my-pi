import { Type, type Static } from 'typebox';

export const HARNESS_VERSION = 2;
export const HARNESS_CUSTOM_TYPE = 'pi-harness-state';

// Explicit command exclusions are optional workflow checks, not a shell sandbox.
export const DEFAULT_FORBIDDEN_COMMANDS: string[] = [];

export const thinking_levels_schema = Type.Union([
	Type.Literal('off'),
	Type.Literal('minimal'),
	Type.Literal('low'),
	Type.Literal('medium'),
	Type.Literal('high'),
	Type.Literal('xhigh'),
]);

export const harness_create_params_schema = Type.Object({
	task: Type.String({ description: 'Task the harness is built for' }),
	slug: Type.Optional(
		Type.String({ description: 'Descriptive filesystem-safe name' }),
	),
	cwd: Type.Optional(
		Type.String({ description: 'Project working directory' }),
	),
	allowed_paths: Type.Optional(
		Type.Array(
			Type.String({
				description:
					'Path or glob-like path the executor may edit, relative to cwd unless absolute',
			}),
		),
	),
	forbidden_paths: Type.Optional(
		Type.Array(
			Type.String({ description: 'Path the executor may not edit' }),
		),
	),
	validation_commands: Type.Array(
		Type.String({
			minLength: 1,
			description: 'Accepted check run before completion',
		}),
		{ minItems: 1 },
	),
	forbidden_commands: Type.Optional(
		Type.Array(
			Type.String({ description: 'Command substring to block' }),
		),
	),
	allow_test_changes: Type.Optional(
		Type.Boolean({
			description: 'Whether executor may edit test files',
		}),
	),
	escalation_rules: Type.Optional(
		Type.Array(
			Type.String({
				description:
					'Condition that requires execution to stop and escalate',
			}),
		),
	),
	planner_model: Type.Optional(Type.String()),
	planner_thinking: Type.Optional(thinking_levels_schema),
	executor_model: Type.Optional(Type.String()),
	executor_thinking: Type.Optional(thinking_levels_schema),
	reviewer_model: Type.Optional(Type.String()),
	reviewer_thinking: Type.Optional(thinking_levels_schema),
});

export type HarnessCreateParams = Static<
	typeof harness_create_params_schema
>;

export const harness_update_params_schema = Type.Object({
	harness_dir: Type.String({
		description: 'Harness directory in /tmp',
	}),
	status: Type.Optional(
		Type.Union([
			Type.Literal('created'),
			Type.Literal('running'),
			Type.Literal('reviewing'),
			Type.Literal('completed'),
			Type.Literal('failed'),
		]),
	),
	phase: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	evidence: Type.Optional(Type.String()),
	team_status: Type.Optional(Type.String()),
	remaining_risks: Type.Optional(Type.Array(Type.String())),
	changed_files: Type.Optional(Type.Array(Type.String())),
});

export type HarnessUpdateParams = Static<
	typeof harness_update_params_schema
>;

export const harness_amend_params_schema = Type.Object({
	harness_dir: Type.String({
		description: 'Harness directory in /tmp',
	}),
	reason: Type.String({
		description: 'Why the scaffold must change',
	}),
	requested_by: Type.Optional(
		Type.Union([Type.Literal('user'), Type.Literal('planner')]),
	),
	task: Type.Optional(Type.String()),
	allowed_paths: Type.Optional(Type.Array(Type.String())),
	validation_commands: Type.Optional(Type.Array(Type.String())),
	allow_test_changes: Type.Optional(Type.Boolean()),
	escalation_rules: Type.Optional(Type.Array(Type.String())),
	planner_model: Type.Optional(Type.String()),
	planner_thinking: Type.Optional(thinking_levels_schema),
	executor_model: Type.Optional(Type.String()),
	executor_thinking: Type.Optional(thinking_levels_schema),
	reviewer_model: Type.Optional(Type.String()),
	reviewer_thinking: Type.Optional(thinking_levels_schema),
});

export type HarnessAmendParams = Static<
	typeof harness_amend_params_schema
>;

export const harness_read_params_schema = Type.Object({
	harness_dir: Type.String({
		description: 'Harness directory in /tmp',
	}),
});

export type HarnessReadParams = Static<
	typeof harness_read_params_schema
>;

export const harness_status_schema = Type.Union([
	Type.Literal('created'),
	Type.Literal('running'),
	Type.Literal('reviewing'),
	Type.Literal('completed'),
	Type.Literal('failed'),
]);

export type HarnessStatus = Static<typeof harness_status_schema>;

export type HarnessThinking = Static<typeof thinking_levels_schema>;

const harness_role_schema = Type.Object({
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(thinking_levels_schema),
});

export const harness_policy_schema = Type.Object({
	cwd: Type.String(),
	forbidden_paths: Type.Array(Type.String()),
	allowed_paths: Type.Optional(Type.Array(Type.String())),
	allow_test_changes: Type.Optional(Type.Boolean()),
	validation_commands: Type.Optional(Type.Array(Type.String())),
	forbidden_commands: Type.Array(Type.String()),
	baseline_changed_files: Type.Array(Type.String()),
	baseline_file_states: Type.Optional(
		Type.Record(Type.String(), Type.String()),
	),
});

export type HarnessPolicy = Static<typeof harness_policy_schema>;

export const harness_scaffold_schema = Type.Object({
	version: Type.Number(),
	task: Type.String(),
	planner: harness_role_schema,
	executor: harness_role_schema,
	reviewer: harness_role_schema,
	allowed_paths: Type.Array(Type.String()),
	validation_commands: Type.Array(Type.String()),
	allow_test_changes: Type.Boolean(),
	escalation_rules: Type.Array(Type.String()),
});

export type HarnessScaffold = Static<typeof harness_scaffold_schema>;

export const harness_amendment_schema = Type.Object({
	timestamp: Type.String(),
	requested_by: Type.Union([
		Type.Literal('user'),
		Type.Literal('planner'),
	]),
	reason: Type.String(),
	from_version: Type.Number(),
	to_version: Type.Number(),
	changes: Type.Array(Type.String()),
});

export type HarnessAmendment = Static<
	typeof harness_amendment_schema
>;

export const harness_contract_schema = Type.Object({
	version: Type.Number(),
	id: Type.String(),
	created_at: Type.String(),
	status: harness_status_schema,
	policy: harness_policy_schema,
	scaffold: harness_scaffold_schema,
	amendments: Type.Array(harness_amendment_schema),
});

export type HarnessContract = Static<typeof harness_contract_schema>;

export const harness_validation_check_schema = Type.Object({
	command: Type.String(),
	passed: Type.Boolean(),
	output_file: Type.String(),
});

export type HarnessValidationCheck = Static<
	typeof harness_validation_check_schema
>;

export const harness_log_entry_schema = Type.Object({
	timestamp: Type.String(),
	status: Type.Optional(harness_status_schema),
	phase: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	evidence: Type.Optional(Type.String()),
	team_status: Type.Optional(Type.String()),
	remaining_risks: Type.Optional(Type.Array(Type.String())),
	changed_files: Type.Optional(Type.Array(Type.String())),
	checks: Type.Optional(Type.Array(harness_validation_check_schema)),
});

export type HarnessLogEntry = Static<typeof harness_log_entry_schema>;

export interface HarnessOutcome {
	id: string;
	status: HarnessStatus;
	phase?: string;
	task: string;
	cwd: string;
	generated_at: string;
	execution_cwd: string;
	changed_files: string[];
	baseline_changed_files: string[];
	validation: {
		commands: string[];
		checks: HarnessValidationCheck[];
		evidence: Array<{
			timestamp: string;
			phase?: string;
			evidence: string;
		}>;
	};
	team_status: string;
	remaining_risks: string[];
	log: HarnessLogEntry[];
}

export const harness_status_file_schema = Type.Object({
	id: Type.String(),
	status: harness_status_schema,
	phase: Type.Optional(Type.String()),
	log: Type.Array(harness_log_entry_schema),
});

export type HarnessStatusFile = Static<
	typeof harness_status_file_schema
>;
