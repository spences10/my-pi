import type {
	CreateAgentSessionFromServicesOptions,
	InlineExtension,
} from '@earendil-works/pi-coding-agent';
import type { BuiltinExtensionOptionName } from '../extensions/builtin-registry.js';

export type MyPiRuntimeMode =
	| 'interactive'
	| 'print'
	| 'json'
	| 'rpc';

export type MyPiThinkingLevel = NonNullable<
	CreateAgentSessionFromServicesOptions['thinkingLevel']
>;

export type BuiltinExtensionOptions = Partial<
	Record<BuiltinExtensionOptionName, boolean>
>;

export interface CreateMyPiOptions extends BuiltinExtensionOptions {
	cwd?: string;
	agent_dir?: string;
	extensions?: string[];
	/** Named wrappers must not use the reserved `my-pi-` prefix. */
	extensionFactories?: InlineExtension[];
	extension_flag_values?: Map<string, boolean | string>;
	runtime_mode?: MyPiRuntimeMode;
	telemetry?: boolean;
	telemetry_db_path?: string;
	model?: string;
	thinking?: MyPiThinkingLevel;
	selected_tools?: string[];
	excluded_tools?: string[];
	selected_skills?: string[];
	session?: string;
	session_id?: string;
	startup_session_name?: string;
	session_dir?: string;
	system_prompt?: string;
	append_system_prompt?: string;
	untrusted_repo?: boolean;
}
