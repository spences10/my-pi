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
import { resolve } from 'node:path';
import { create_chain_extension } from './extensions/chain.js';
import { create_filter_output_extension } from './extensions/filter-output.js';
import { create_handoff_extension } from './extensions/handoff.js';
import { create_mcp_extension } from './extensions/mcp.js';
import { create_skills_extension } from './extensions/skills.js';
import { create_skills_manager } from './skills/manager.js';

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
		model,
	} = options;

	const resolved_extensions = extensions.map((p) => resolve(cwd, p));
	const skills_mgr = skills ? create_skills_manager() : null;

	const builtin_factories: ExtensionFactory[] = [
		...(mcp ? [create_mcp_extension(cwd)] : []),
		...(skills && skills_mgr
			? [create_skills_extension(skills_mgr)]
			: []),
		...(chain ? [create_chain_extension(cwd)] : []),
		...(filter_output ? [create_filter_output_extension()] : []),
		...(handoff ? [create_handoff_extension()] : []),
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
				additionalExtensionPaths: resolved_extensions,
				extensionFactories: [...builtin_factories, ...user_factories],
				skillsOverride: skills_mgr
					? (base) => ({
							skills: base.skills.filter((s) =>
								skills_mgr.is_enabled_by_skill(s.name, s.filePath),
							),
							diagnostics: base.diagnostics,
						})
					: undefined,
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
	runPrintMode
} from '@mariozechner/pi-coding-agent';

export type {
	AgentSessionRuntime,
	ExtensionFactory,
	InteractiveModeOptions,
	PrintModeOptions
} from '@mariozechner/pi-coding-agent';

