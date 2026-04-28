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
import confirm_destructive_extension from '@spences10/pi-confirm-destructive';
import lsp_extension from '@spences10/pi-lsp';
import mcp_extension from '@spences10/pi-mcp';
import nopeek_extension from '@spences10/pi-nopeek';
import omnisearch_extension from '@spences10/pi-omnisearch';
import recall_extension from '@spences10/pi-recall';
import filter_output_extension from '@spences10/pi-redact';
import skills_extension, {
	create_skills_manager,
} from '@spences10/pi-skills';
import sqlite_tools_extension from '@spences10/pi-sqlite-tools';
import { create_telemetry_extension } from '@spences10/pi-telemetry';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import hooks_resolution_extension from './extensions/hooks-resolution/index.js';
import {
	BUILTIN_EXTENSIONS,
	is_builtin_extension_active,
	load_builtin_extensions_config,
	type BuiltinExtensionKey,
} from './extensions/manager/config.js';
import { create_extensions_extension } from './extensions/manager/index.js';
import prompt_presets_extension from './extensions/prompt-presets/index.js';
import session_name_extension from './extensions/session-name/index.js';

export type MyPiRuntimeMode = 'interactive' | 'print' | 'json';

export interface CreateMyPiOptions {
	cwd?: string;
	agent_dir?: string;
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	runtime_mode?: MyPiRuntimeMode;
	mcp?: boolean;
	skills?: boolean;
	filter_output?: boolean;
	recall?: boolean;
	nopeek?: boolean;
	omnisearch?: boolean;
	sqlite_tools?: boolean;
	prompt_presets?: boolean;
	lsp?: boolean;
	session_name?: boolean;
	confirm_destructive?: boolean;
	hooks_resolution?: boolean;
	telemetry?: boolean;
	telemetry_db_path?: string;
	model?: string;
	system_prompt?: string;
	append_system_prompt?: string;
	untrusted_repo?: boolean;
}

const BUILTIN_EXTENSION_FACTORIES: Record<
	BuiltinExtensionKey,
	ExtensionFactory
> = {
	mcp: mcp_extension,
	skills: skills_extension,
	'filter-output': filter_output_extension,
	recall: recall_extension,
	nopeek: nopeek_extension,
	omnisearch: omnisearch_extension,
	'sqlite-tools': sqlite_tools_extension,
	'prompt-presets': prompt_presets_extension,
	lsp: lsp_extension,
	'session-name': session_name_extension,
	'confirm-destructive': confirm_destructive_extension,
	'hooks-resolution': hooks_resolution_extension,
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_THEME_DIR = resolve(MODULE_DIR, '..', 'themes');
const PI_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

const UNTRUSTED_REPO_ENV_DEFAULTS: Record<string, string> = {
	MY_PI_MCP_PROJECT_CONFIG: 'skip',
	MY_PI_HOOKS_CONFIG: 'skip',
	MY_PI_LSP_PROJECT_BINARY: 'global',
	MY_PI_PROMPT_PRESETS_PROJECT: 'skip',
	MY_PI_PROJECT_SKILLS: 'skip',
	MY_PI_CHILD_ENV_ALLOWLIST: '',
	MY_PI_MCP_ENV_ALLOWLIST: '',
	MY_PI_HOOKS_ENV_ALLOWLIST: '',
};

export function apply_untrusted_repo_defaults(
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const applied: string[] = [];
	for (const [key, value] of Object.entries(
		UNTRUSTED_REPO_ENV_DEFAULTS,
	)) {
		if (env[key] !== undefined) continue;
		env[key] = value;
		applied.push(key);
	}
	return applied;
}

function is_resource_enabled(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return true;
	if (['0', 'false', 'no', 'skip', 'disable'].includes(normalized)) {
		return false;
	}
	return true;
}

export function is_project_local_skill_path(
	cwd: string,
	file_path: string | undefined,
): boolean {
	if (!file_path) return false;
	const absolute = resolve(cwd, file_path);
	const relative_path = relative(cwd, absolute);
	if (
		!relative_path ||
		relative_path.startsWith('..') ||
		isAbsolute(relative_path)
	) {
		return false;
	}
	const parts = relative_path.split(/[\\/]+/);
	return parts.some(
		(part, index) =>
			(part === '.pi' || part === '.claude') &&
			parts[index + 1] === 'skills',
	);
}

function resolve_agent_dir(cwd: string, agent_dir?: string): string {
	return agent_dir ? resolve(cwd, agent_dir) : getAgentDir();
}

const NON_INTERACTIVE_UI_ONLY_BUILTINS: BuiltinExtensionKey[] = [
	'session-name',
];

export function get_force_disabled_builtins(
	options: Pick<
		CreateMyPiOptions,
		| 'runtime_mode'
		| 'mcp'
		| 'skills'
		| 'filter_output'
		| 'recall'
		| 'nopeek'
		| 'omnisearch'
		| 'sqlite_tools'
		| 'prompt_presets'
		| 'lsp'
		| 'session_name'
		| 'confirm_destructive'
		| 'hooks_resolution'
	>,
): ReadonlySet<BuiltinExtensionKey> {
	const force_disabled = new Set<BuiltinExtensionKey>();
	if (!options.mcp) force_disabled.add('mcp');
	if (!options.skills) force_disabled.add('skills');
	if (!options.filter_output) force_disabled.add('filter-output');
	if (!options.recall) force_disabled.add('recall');
	if (!options.nopeek) force_disabled.add('nopeek');
	if (!options.omnisearch) force_disabled.add('omnisearch');
	if (!options.sqlite_tools) force_disabled.add('sqlite-tools');
	if (!options.prompt_presets) force_disabled.add('prompt-presets');
	if (!options.lsp) force_disabled.add('lsp');
	if (!options.session_name) force_disabled.add('session-name');
	if (!options.confirm_destructive)
		force_disabled.add('confirm-destructive');
	if (!options.hooks_resolution)
		force_disabled.add('hooks-resolution');
	if (
		options.runtime_mode &&
		options.runtime_mode !== 'interactive'
	) {
		for (const key of NON_INTERACTIVE_UI_ONLY_BUILTINS) {
			force_disabled.add(key);
		}
	}
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
		agent_dir,
		extensions = [],
		extensionFactories: user_factories = [],
		runtime_mode = 'interactive',
		mcp = true,
		skills = true,
		filter_output = true,
		recall = true,
		nopeek = true,
		omnisearch = true,
		sqlite_tools = true,
		prompt_presets = true,
		lsp = true,
		session_name = true,
		confirm_destructive = true,
		hooks_resolution = true,
		telemetry,
		telemetry_db_path,
		model,
		system_prompt,
		append_system_prompt,
		untrusted_repo = false,
	} = options;

	if (untrusted_repo) {
		apply_untrusted_repo_defaults();
	}

	const effective_agent_dir = resolve_agent_dir(cwd, agent_dir);
	if (agent_dir) {
		process.env[PI_AGENT_DIR_ENV] = effective_agent_dir;
	}

	const resolved_extensions = extensions.map((p) => resolve(cwd, p));
	const force_disabled = get_force_disabled_builtins({
		runtime_mode,
		mcp,
		skills,
		filter_output,
		recall,
		nopeek,
		omnisearch,
		sqlite_tools,
		prompt_presets,
		lsp,
		session_name,
		confirm_destructive,
		hooks_resolution,
	});
	const managed_extension_factories: ExtensionFactory[] = [
		create_telemetry_extension({
			enabled: telemetry,
			db_path: telemetry_db_path,
			cwd,
		}),
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
					const sm = SettingsManager.create(
						runtime_cwd,
						effective_agent_dir,
					);
					sm.setDefaultModel(model);
					return sm;
				})()
			: undefined;

		const services = await createAgentSessionServices({
			cwd: runtime_cwd,
			agentDir: effective_agent_dir,
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
				...(runtime_mode === 'interactive'
					? { additionalThemePaths: [PACKAGE_THEME_DIR] }
					: {}),
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

					const include_project_skills = is_resource_enabled(
						process.env.MY_PI_PROJECT_SKILLS,
					);
					const skills_manager = create_skills_manager();
					return {
						...base,
						skills: base.skills.filter((skill: any) => {
							if (
								!include_project_skills &&
								is_project_local_skill_path(
									runtime_cwd,
									skill.filePath,
								)
							) {
								return false;
							}
							return skills_manager.is_enabled_by_skill(
								skill.name,
								skill.filePath,
							);
						}),
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
		agentDir: effective_agent_dir,
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
