import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { register_context_commands } from './commands/context-command.js';
import { register_context_lifecycle } from './lifecycle.js';
import { register_context_tools } from './tools/index.js';

export default function context_sidecar(pi: ExtensionAPI): void {
	register_context_lifecycle(pi);
	register_context_tools(pi);
	register_context_commands(pi);
}

export {
	context_settings_from_preset,
	CONTEXT_SETTINGS_PRESETS,
	get_context_capture_limits,
	get_context_mcp_output_limits,
	get_context_settings_config_path,
	load_context_settings_config,
	save_context_settings_config,
} from './config.js';
export type {
	ContextOutputLimits,
	ContextSettingsConfig,
	ContextSettingsPreset,
	ContextSettingsValues,
} from './config.js';
export {
	run_context_eval,
	run_context_eval_cli,
} from './eval/index.js';
export {
	get_context_store,
	is_context_sidecar_enabled,
	maybe_store_context_output,
	parse_context_retention_policy,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';
export type {
	ContextCleanupResult,
	ContextListResult,
	ContextPurgeDetails,
	ContextRetentionPolicy,
	ContextScopeOptions,
	ContextSearchResult,
	ContextStats,
	StoreContextInput,
	StoredContextOutput,
} from './store.js';

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === process.argv[1]
) {
	const { run_context_eval_cli } = await import('./eval/index.js');
	await run_context_eval_cli();
}
