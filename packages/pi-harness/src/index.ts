import {
	harness_amend_params_schema,
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
} from './schema.js';

export {
	check_command_allowed,
	check_path_allowed,
} from './enforcement/policy.js';
export {
	default,
	should_inject_harness_prompt,
} from './extension.js';
export { HARNESS_SYSTEM_PROMPT } from './prompt.js';
export {
	active_harness_context,
	amend_harness_runtime,
	create_harness_runtime,
	format_harness_status_line,
	format_harness_summary,
	update_harness_runtime,
} from './runtime/index.js';
export {
	collect_harness_outcome,
	render_outcome_markdown,
	write_outcome_artifacts,
} from './runtime/outcome.js';
export {
	DEFAULT_FORBIDDEN_COMMANDS,
	harness_amend_params_schema,
	harness_create_params_schema,
	HARNESS_CUSTOM_TYPE,
	harness_read_params_schema,
	harness_update_params_schema,
	HARNESS_VERSION,
	thinking_levels_schema,
} from './schema.js';
export type {
	HarnessAmendment,
	HarnessAmendParams,
	HarnessContract,
	HarnessCreateParams,
	HarnessLogEntry,
	HarnessOutcome,
	HarnessPolicy,
	HarnessReadParams,
	HarnessScaffold,
	HarnessStatus,
	HarnessStatusFile,
	HarnessThinking,
	HarnessUpdateParams,
} from './schema.js';

export const testing = {
	harness_amend_params_schema,
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
};
