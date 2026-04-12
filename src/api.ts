// Composable programmatic API for my-pi
// Extension loading patterns inspired by https://github.com/disler/pi-vs-claude-code

import {
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionServices,
	type ExtensionFactory,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from '@mariozechner/pi-coding-agent';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ext_dir = resolve(__dirname, '..', 'src', 'extensions');

export interface CreateMyPiOptions {
	cwd?: string;
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	/** Enable MCP extension (default true) */
	mcp?: boolean;
	/** Enable skills extension (default true) */
	skills?: boolean;
	/** Enable chain extension (default true) */
	chain?: boolean;
	/** Enable filter-output extension for secret redaction (default true) */
	filter_output?: boolean;
	/** Enable handoff extension (default true) */
	handoff?: boolean;
	/** Enable recall extension for searching past sessions (default true) */
	recall?: boolean;
	/** Override the default model (e.g. "claude-sonnet-4-5-20241022") */
	model?: string;
}

export async function create_my_pi(
	options: CreateMyPiOptions = {},
): Promise<AgentSessionRuntime> {
	const {
		cwd = process.cwd(),
		extensions = [],
		extensionFactories: user_factories = [],
		mcp = true,
		skills = true,
		chain = true,
		filter_output = true,
		handoff = true,
		recall = true,
		model,
	} = options;

	const resolved_extensions = extensions.map((p) => resolve(cwd, p));

	// All built-in extensions loaded by path so Pi shows filenames
	const builtin_extension_paths: string[] = [
		...(mcp ? [resolve(ext_dir, 'mcp.ts')] : []),
		...(skills ? [resolve(ext_dir, 'skills.ts')] : []),
		...(chain ? [resolve(ext_dir, 'chain.ts')] : []),
		...(filter_output ? [resolve(ext_dir, 'filter-output.ts')] : []),
		...(handoff ? [resolve(ext_dir, 'handoff.ts')] : []),
		...(recall ? [resolve(ext_dir, 'recall.ts')] : []),
	];

	const create_runtime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtime_cwd,
		sessionManager,
		sessionStartEvent,
	}) => {
		const settings_manager = model
			? (() => {
					const sm = SettingsManager.create(runtime_cwd);
					sm.setDefaultModel(model);
					return sm;
				})()
			: undefined;

		const services = await createAgentSessionServices({
			cwd: runtime_cwd,
			...(settings_manager && { settingsManager: settings_manager }),
			resourceLoaderOptions: {
				additionalExtensionPaths: [
					...builtin_extension_paths,
					...resolved_extensions,
				],
				extensionFactories: [...user_factories],
			},
		});

		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	return createAgentSessionRuntime(create_runtime, {
		cwd,
		agentDir: getAgentDir(),
		sessionManager: SessionManager.create(cwd),
	});
}

export {
	InteractiveMode,
	runPrintMode,
} from '@mariozechner/pi-coding-agent';

export type {
	AgentSessionRuntime,
	ExtensionFactory,
	InteractiveModeOptions,
	PrintModeOptions,
} from '@mariozechner/pi-coding-agent';
