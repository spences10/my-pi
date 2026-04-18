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
	type LoadExtensionsResult,
} from '@mariozechner/pi-coding-agent';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chain_extension from './extensions/chain.js';
import {
	BUILTIN_EXTENSIONS,
	is_builtin_extension_active,
	load_builtin_extensions_config,
	type BuiltinExtensionKey,
} from './extensions/config.js';
import { create_extensions_extension } from './extensions/extensions.js';
import filter_output_extension from './extensions/filter-output.js';
import handoff_extension from './extensions/handoff.js';
import lsp_extension from './extensions/lsp.js';
import mcp_extension from './extensions/mcp.js';
import prompt_presets_extension from './extensions/prompt-presets.js';
import recall_extension from './extensions/recall.js';
import skills_extension from './extensions/skills.js';
import { create_skills_manager } from './skills/manager.js';

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
	prompt_presets?: boolean;
	lsp?: boolean;
	model?: string;
	system_prompt?: string;
	append_system_prompt?: string;
}

const BUILTIN_EXTENSION_FACTORIES: Record<
	BuiltinExtensionKey,
	ExtensionFactory
> = {
	mcp: mcp_extension,
	skills: skills_extension,
	chain: chain_extension,
	'filter-output': filter_output_extension,
	handoff: handoff_extension,
	recall: recall_extension,
	'prompt-presets': prompt_presets_extension,
	lsp: lsp_extension,
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_THEME_DIR = resolve(MODULE_DIR, '..', 'themes');

function get_force_disabled_builtins(
	options: Pick<
		CreateMyPiOptions,
		| 'mcp'
		| 'skills'
		| 'chain'
		| 'filter_output'
		| 'handoff'
		| 'recall'
		| 'prompt_presets'
		| 'lsp'
	>,
): ReadonlySet<BuiltinExtensionKey> {
	const force_disabled = new Set<BuiltinExtensionKey>();
	if (!options.mcp) force_disabled.add('mcp');
	if (!options.skills) force_disabled.add('skills');
	if (!options.chain) force_disabled.add('chain');
	if (!options.filter_output) force_disabled.add('filter-output');
	if (!options.handoff) force_disabled.add('handoff');
	if (!options.recall) force_disabled.add('recall');
	if (!options.prompt_presets) force_disabled.add('prompt-presets');
	if (!options.lsp) force_disabled.add('lsp');
	return force_disabled;
}

function create_builtin_extension_factory(
	key: BuiltinExtensionKey,
	extension: ExtensionFactory,
	force_disabled: ReadonlySet<BuiltinExtensionKey>,
): ExtensionFactory {
	return async (pi) => {
		const config = load_builtin_extensions_config();
		if (!is_builtin_extension_active(config, key, force_disabled)) {
			return;
		}
		await extension(pi);
	};
}

function create_extensions_override(
	managed_inline_paths: string[],
): (base: LoadExtensionsResult) => LoadExtensionsResult {
	const managed_paths = new Set(managed_inline_paths);
	return (base) => {
		const managed = new Map(
			base.extensions.map((extension) => [extension.path, extension]),
		);
		const ordered_managed = managed_inline_paths
			.map((path) => managed.get(path))
			.filter(
				(
					extension,
				): extension is LoadExtensionsResult['extensions'][number] =>
					Boolean(extension),
			);
		const others = base.extensions.filter(
			(extension) => !managed_paths.has(extension.path),
		);
		return {
			...base,
			extensions: [...ordered_managed, ...others],
		};
	};
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
		prompt_presets = true,
		lsp = true,
		model,
		system_prompt,
		append_system_prompt,
	} = options;

	const resolved_extensions = extensions.map((p) => resolve(cwd, p));
	const force_disabled = get_force_disabled_builtins({
		mcp,
		skills,
		chain,
		filter_output,
		handoff,
		recall,
		prompt_presets,
		lsp,
	});
	const managed_extension_factories: ExtensionFactory[] = [
		create_extensions_extension({ force_disabled }),
		...BUILTIN_EXTENSIONS.map((extension) =>
			create_builtin_extension_factory(
				extension.key,
				BUILTIN_EXTENSION_FACTORIES[extension.key],
				force_disabled,
			),
		),
	];
	const managed_inline_paths = managed_extension_factories.map(
		(_, index) => `<inline:${index + 1}>`,
	);

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
				...(system_prompt !== undefined
					? {
							systemPromptOverride: () => system_prompt,
						}
					: {}),
				...(append_system_prompt !== undefined
					? {
							appendSystemPromptOverride: (base: string[]) => [
								...base,
								append_system_prompt,
							],
						}
					: {}),
				additionalExtensionPaths: [...resolved_extensions],
				additionalThemePaths: [PACKAGE_THEME_DIR],
				extensionFactories: [
					...managed_extension_factories,
					...user_factories,
				],
				extensionsOverride: create_extensions_override(
					managed_inline_paths,
				),
				skillsOverride: (base: any) => {
					const config = load_builtin_extensions_config();
					if (
						!is_builtin_extension_active(
							config,
							'skills',
							force_disabled,
						)
					) {
						return base;
					}

					const skills_manager = create_skills_manager();
					return {
						...base,
						skills: base.skills.filter((skill: any) =>
							skills_manager.is_enabled_by_skill(
								skill.name,
								skill.filePath,
							),
						),
					};
				},
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
