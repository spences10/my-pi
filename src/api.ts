// Composable programmatic API for my-pi
// Extension loading patterns inspired by pi-vs-claude-code

import {
	InteractiveMode,
	SessionManager,
	SettingsManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	runPrintMode,
	type ExtensionFactory,
} from '@mariozechner/pi-coding-agent';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create_skills_manager } from './skills/manager.js';

const ext_dir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'src',
	'extensions',
);

export interface CreateMyPiOptions {
	cwd?: string;
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	mcp?: boolean;
	skills?: boolean;
	chain?: boolean;
	filter_output?: boolean;
	handoff?: boolean;
	recall?: boolean;
	model?: string;
}

export async function create_my_pi(options: CreateMyPiOptions = {}) {
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
	const builtin_extension_paths = [
		...(mcp ? [resolve(ext_dir, 'mcp.ts')] : []),
		...(skills ? [resolve(ext_dir, 'skills.ts')] : []),
		...(chain ? [resolve(ext_dir, 'chain.ts')] : []),
		...(filter_output ? [resolve(ext_dir, 'filter-output.ts')] : []),
		...(handoff ? [resolve(ext_dir, 'handoff.ts')] : []),
		...(recall ? [resolve(ext_dir, 'recall.ts')] : []),
	];
	const skills_manager = skills ? create_skills_manager() : undefined;

	const create_runtime = async ({
		cwd: runtime_cwd,
		sessionManager,
		sessionStartEvent,
	}: {
		cwd: string;
		sessionManager: SessionManager;
		sessionStartEvent?: unknown;
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
			...(settings_manager
				? { settingsManager: settings_manager }
				: {}),
			resourceLoaderOptions: {
				additionalExtensionPaths: [
					...builtin_extension_paths,
					...resolved_extensions,
				],
				extensionFactories: [...user_factories],
				...(skills_manager
					? {
							skillsOverride: (base: any) => ({
								...base,
								skills: base.skills.filter((skill: any) =>
									skills_manager.is_enabled_by_skill(
										skill.name,
										skill.filePath,
									),
								),
							}),
						}
					: {}),
			} as any,
		});

		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent: sessionStartEvent as any,
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

export { InteractiveMode, runPrintMode };

export type {
	AgentSessionRuntime,
	ExtensionFactory,
	InteractiveModeOptions,
	PrintModeOptions,
} from '@mariozechner/pi-coding-agent';
