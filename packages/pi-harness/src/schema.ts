import { Type, type Static } from 'typebox';

export const HARNESS_VERSION = 2;
export const HARNESS_CUSTOM_TYPE = 'pi-harness-state';
export const DEFAULT_FORBIDDEN_COMMANDS = [
	'rm -rf .git',
	'git reset --hard',
	'git clean -fd',
	'--updateSnapshot',
	' -u ',
];

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
	validation_commands: Type.Optional(
		Type.Array(Type.String({ description: 'Command run from cwd' })),
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

export type HarnessStatus =
	| 'created'
	| 'running'
	| 'reviewing'
	| 'completed'
	| 'failed';
export type HarnessThinking = Static<typeof thinking_levels_schema>;

export interface HarnessPolicy {
	cwd: string;
	forbidden_paths: string[];
	allowed_tools: string[];
	forbidden_commands: string[];
	baseline_changed_files: string[];
}

export interface HarnessScaffold {
	version: number;
	task: string;
	planner: { model?: string; thinking?: HarnessThinking };
	executor: { model?: string; thinking?: HarnessThinking };
	reviewer: { model?: string; thinking?: HarnessThinking };
	allowed_paths: string[];
	validation_commands: string[];
	allow_test_changes: boolean;
	escalation_rules: string[];
}

export interface HarnessAmendment {
	timestamp: string;
	requested_by: 'user' | 'planner';
	reason: string;
	from_version: number;
	to_version: number;
	changes: string[];
}

export interface HarnessContract {
	version: typeof HARNESS_VERSION;
	id: string;
	created_at: string;
	status: HarnessStatus;
	policy: HarnessPolicy;
	scaffold: HarnessScaffold;
	amendments: HarnessAmendment[];
}

export interface HarnessLogEntry {
	timestamp: string;
	status?: HarnessStatus;
	phase?: string;
	note?: string;
	evidence?: string;
	team_status?: string;
	remaining_risks?: string[];
	changed_files?: string[];
}

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

export interface HarnessStatusFile {
	id: string;
	status: HarnessStatus;
	phase?: string;
	log: HarnessLogEntry[];
}
