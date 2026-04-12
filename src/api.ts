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
} from '@mariozechner/pi-coding-agent';
import { resolve } from 'node:path';
import { create_mcp_extension } from './extensions/mcp.js';
import { create_skills_extension } from './extensions/skills.js';
import { create_skills_manager } from './skills/manager.js';

export interface CreateMyPiOptions {
	cwd?: string;
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	builtins?: boolean;
}

export async function createMyPi(
	options: CreateMyPiOptions = {},
): Promise<AgentSessionRuntime> {
	const {
		cwd = process.cwd(),
		extensions = [],
		extensionFactories: userFactories = [],
		builtins = true,
	} = options;

	const resolvedExtensions = extensions.map((p) =>
		resolve(cwd, p),
	);
	const skills_mgr = builtins
		? create_skills_manager()
		: null;

	const builtinFactories: ExtensionFactory[] = builtins
		? [
				create_mcp_extension(cwd),
				create_skills_extension(skills_mgr!),
			]
		: [];

	const createRuntime: CreateAgentSessionRuntimeFactory =
		async ({
			cwd: runtime_cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd: runtime_cwd,
				resourceLoaderOptions: {
					additionalExtensionPaths: resolvedExtensions,
					extensionFactories: [
						...builtinFactories,
						...userFactories,
					],
					skillsOverride: skills_mgr
						? (base) => ({
								skills: base.skills.filter((s) =>
									skills_mgr.is_enabled_by_skill(
										s.name,
										s.filePath,
									),
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

	return createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir: getAgentDir(),
		sessionManager: SessionManager.create(cwd),
	});
}

export {
	InteractiveMode, runPrintMode
} from '@mariozechner/pi-coding-agent';

export type {
	AgentSessionRuntime, ExtensionFactory,
	InteractiveModeOptions, PrintModeOptions
} from '@mariozechner/pi-coding-agent';
