// Composable programmatic API for my-pi
// Extension loading patterns inspired by pi-vs-claude-code

import {
	clampThinkingLevel,
	type Api,
	type Model,
} from '@mariozechner/pi-ai';
import {
	InteractiveMode,
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	runPrintMode,
	runRpcMode,
	type CreateAgentSessionFromServicesOptions,
	type ExtensionFactory,
	type LoadExtensionsResult,
} from '@mariozechner/pi-coding-agent';
import { apply_project_trust_untrusted_defaults } from '@spences10/pi-project-trust';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
	BUILTIN_EXTENSION_REGISTRY,
	type BuiltinExtensionKey,
	type BuiltinExtensionOptionName,
} from './extensions/builtin-registry.js';
import {
	is_builtin_extension_active,
	load_builtin_extensions_config,
} from './extensions/manager/config.js';
import { create_extensions_extension } from './extensions/manager/index.js';

export type MyPiRuntimeMode =
	| 'interactive'
	| 'print'
	| 'json'
	| 'rpc';

export type MyPiThinkingLevel = NonNullable<
	CreateAgentSessionFromServicesOptions['thinkingLevel']
>;

type BuiltinExtensionOptions = Partial<
	Record<BuiltinExtensionOptionName, boolean>
>;

export interface CreateMyPiOptions extends BuiltinExtensionOptions {
	cwd?: string;
	agent_dir?: string;
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	runtime_mode?: MyPiRuntimeMode;
	telemetry?: boolean;
	telemetry_db_path?: string;
	model?: string;
	thinking?: MyPiThinkingLevel;
	selected_tools?: string[];
	selected_skills?: string[];
	session_dir?: string;
	system_prompt?: string;
	append_system_prompt?: string;
	untrusted_repo?: boolean;
}

type BuiltinExtensionLoader = () => Promise<ExtensionFactory>;

const require = createRequire(import.meta.url);
const PACKAGE_THEME_DIR = resolve(
	dirname(require.resolve('@spences10/pi-themes/package.json')),
	'themes',
);
const PI_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';
const MY_PI_RUNTIME_MODE_ENV = 'MY_PI_RUNTIME_MODE';

type EnvSnapshot = Map<string, string | undefined>;

function snapshot_env(
	env: NodeJS.ProcessEnv,
	keys: Iterable<string>,
): EnvSnapshot {
	return new Map(Array.from(keys, (key) => [key, env[key]]));
}

function restore_env(
	env: NodeJS.ProcessEnv,
	snapshot: EnvSnapshot,
): void {
	for (const [key, value] of snapshot) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
}

function wrap_runtime_env_restore<
	T extends { dispose(): Promise<void> },
>(runtime: T, restore: () => void): T {
	const dispose = runtime.dispose.bind(runtime);
	let restored = false;
	const restore_once = () => {
		if (restored) return;
		restored = true;
		restore();
	};

	runtime.dispose = (async () => {
		try {
			await dispose();
		} finally {
			restore_once();
		}
	}) as T['dispose'];

	return runtime;
}

const UNTRUSTED_CHILD_ENV_DEFAULTS: Record<string, string> = {
	MY_PI_CHILD_ENV_ALLOWLIST: '',
	MY_PI_MCP_ENV_ALLOWLIST: '',
	MY_PI_LSP_ENV_ALLOWLIST: '',
	MY_PI_HOOKS_ENV_ALLOWLIST: '',
	MY_PI_TEAM_MODE_ENV_ALLOWLIST: '',
};

export function apply_untrusted_repo_defaults(
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const applied = apply_project_trust_untrusted_defaults(env);
	for (const [key, value] of Object.entries(
		UNTRUSTED_CHILD_ENV_DEFAULTS,
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

interface ModelRegistryLike {
	getAll(): Model<Api>[];
}

export function resolve_model_reference(
	model_reference: string | undefined,
	model_registry: ModelRegistryLike,
): Model<Api> | undefined {
	if (!model_reference) return undefined;
	const models = model_registry.getAll();
	const lower_reference = model_reference.toLowerCase();
	const slash_index = model_reference.indexOf('/');

	if (slash_index !== -1) {
		const maybe_provider = model_reference.slice(0, slash_index);
		const model_id = model_reference.slice(slash_index + 1);
		const provider = models.find(
			(model) =>
				model.provider.toLowerCase() === maybe_provider.toLowerCase(),
		)?.provider;

		if (provider) {
			const provider_match = models.find(
				(model) =>
					model.provider === provider &&
					model.id.toLowerCase() === model_id.toLowerCase(),
			);
			if (provider_match) return provider_match;
		}
	}

	return models.find((model) => {
		const id = model.id.toLowerCase();
		const full_id = `${model.provider}/${model.id}`.toLowerCase();
		return id === lower_reference || full_id === lower_reference;
	});
}

export function resolve_effective_thinking_level(
	model: Model<Api> | undefined,
	thinking: MyPiThinkingLevel | undefined,
): MyPiThinkingLevel | undefined {
	if (!thinking || !model) return thinking;
	return clampThinkingLevel(model, thinking);
}

export function get_force_disabled_builtins(
	options: Pick<CreateMyPiOptions, 'runtime_mode'> &
		BuiltinExtensionOptions,
): ReadonlySet<BuiltinExtensionKey> {
	const force_disabled = new Set<BuiltinExtensionKey>();
	for (const extension of BUILTIN_EXTENSION_REGISTRY) {
		const enabled =
			options[extension.option_name] ?? extension.default_enabled;
		if (!enabled) force_disabled.add(extension.key);
		const disabled_in =
			'mode_constraints' in extension
				? extension.mode_constraints.disabled_in
				: undefined;
		if (
			options.runtime_mode &&
			(
				disabled_in as readonly MyPiRuntimeMode[] | undefined
			)?.includes(options.runtime_mode)
		) {
			force_disabled.add(extension.key);
		}
	}
	return force_disabled;
}

export function create_lazy_builtin_extension_factory(
	key: BuiltinExtensionKey,
	load_extension: BuiltinExtensionLoader,
	force_disabled: ReadonlySet<BuiltinExtensionKey>,
): ExtensionFactory {
	return async (pi) => {
		const config = load_builtin_extensions_config();
		if (!is_builtin_extension_active(config, key, force_disabled)) {
			return;
		}
		const extension = await load_extension();
		await extension(pi);
	};
}

function create_lazy_telemetry_extension(options: {
	enabled?: boolean;
	db_path?: string;
	cwd?: string;
}): ExtensionFactory {
	return async (pi) => {
		const { create_telemetry_extension } =
			await import('@spences10/pi-telemetry');
		await create_telemetry_extension(options)(pi);
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
		telemetry,
		telemetry_db_path,
		model,
		thinking,
		selected_tools,
		selected_skills,
		session_dir,
		system_prompt,
		append_system_prompt,
		untrusted_repo = false,
	} = options;

	const env_keys_to_restore = new Set<string>([
		MY_PI_RUNTIME_MODE_ENV,
	]);
	if (agent_dir) env_keys_to_restore.add(PI_AGENT_DIR_ENV);
	const env_snapshot = snapshot_env(process.env, env_keys_to_restore);
	let restore_runtime_env = () =>
		restore_env(process.env, env_snapshot);

	if (untrusted_repo) {
		const applied = apply_untrusted_repo_defaults();
		if (applied.length) {
			const restore_previous = restore_runtime_env;
			restore_runtime_env = () => {
				for (const key of applied) delete process.env[key];
				restore_previous();
			};
		}
	}

	const effective_agent_dir = resolve_agent_dir(cwd, agent_dir);
	if (agent_dir) {
		process.env[PI_AGENT_DIR_ENV] = effective_agent_dir;
	}
	process.env[MY_PI_RUNTIME_MODE_ENV] = runtime_mode;

	const resolved_extensions = extensions.map((p) => resolve(cwd, p));
	const force_disabled = get_force_disabled_builtins({
		...options,
		runtime_mode,
	});
	const builtins_config = load_builtin_extensions_config();
	const skills_manager = is_builtin_extension_active(
		builtins_config,
		'skills',
		force_disabled,
	)
		? (await import('@spences10/pi-skills')).create_skills_manager()
		: undefined;

	const managed_extension_factories: ExtensionFactory[] = [
		create_lazy_telemetry_extension({
			enabled: telemetry,
			db_path: telemetry_db_path,
			cwd,
		}),
		create_extensions_extension({ force_disabled }),
		...BUILTIN_EXTENSION_REGISTRY.map((extension) =>
			create_lazy_builtin_extension_factory(
				extension.key,
				extension.load,
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
		const services = await createAgentSessionServices({
			cwd: runtime_cwd,
			agentDir: effective_agent_dir,
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
					if (!skills_manager) return base;

					const include_project_skills = is_resource_enabled(
						process.env.MY_PI_PROJECT_SKILLS,
					);
					const selected_skill_names = selected_skills?.length
						? new Set(selected_skills)
						: undefined;
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
							if (
								selected_skill_names &&
								!selected_skill_names.has(skill.name)
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

		const requested_model = resolve_model_reference(
			model,
			services.modelRegistry,
		);
		const effective_thinking = resolve_effective_thinking_level(
			requested_model,
			thinking,
		);
		if (
			requested_model &&
			thinking &&
			effective_thinking &&
			effective_thinking !== thinking
		) {
			services.diagnostics.push({
				type: 'warning',
				message: `Requested thinking level "${thinking}" is not supported by ${requested_model.provider}/${requested_model.id}; using "${effective_thinking}".`,
			});
		}

		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent: sessionStartEvent as any,
				...(requested_model ? { model: requested_model } : {}),
				...(effective_thinking
					? { thinkingLevel: effective_thinking }
					: {}),
				...(selected_tools?.length ? { tools: selected_tools } : {}),
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	try {
		return wrap_runtime_env_restore(
			await createAgentSessionRuntime(create_runtime, {
				cwd,
				agentDir: effective_agent_dir,
				sessionManager: SessionManager.create(
					cwd,
					session_dir ? resolve(cwd, session_dir) : undefined,
				),
			}),
			restore_runtime_env,
		);
	} catch (error) {
		restore_runtime_env();
		throw error;
	}
}

export { InteractiveMode, runPrintMode, runRpcMode };

export type {
	AgentSessionRuntime,
	ExtensionFactory,
	InteractiveModeOptions,
	PrintModeOptions,
} from '@mariozechner/pi-coding-agent';
