import {
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
} from './schema.js';

export { default } from './extension.js';
export { should_inject_harness_prompt } from './extension.js';
export {
	check_command_allowed,
	check_path_allowed,
} from './enforcement/policy.js';
export { HARNESS_SYSTEM_PROMPT } from './prompt.js';
export {
	active_harness_context,
	create_harness_runtime,
	format_harness_summary,
	update_harness_runtime,
} from './runtime/index.js';
export {
	collect_harness_outcome,
	render_outcome_markdown,
	write_outcome_artifacts,
} from './runtime/outcome.js';
export type {
	HarnessContract,
	HarnessCreateParams,
	HarnessLogEntry,
	HarnessOutcome,
	HarnessReadParams,
	HarnessStatus,
	HarnessStatusFile,
	HarnessThinking,
	HarnessUpdateParams,
} from './schema.js';
export {
	DEFAULT_FORBIDDEN_COMMANDS,
	HARNESS_CUSTOM_TYPE,
	HARNESS_VERSION,
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
	thinking_levels_schema,
} from './schema.js';

export const testing = {
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
};
