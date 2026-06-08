// Composable programmatic API for my-pi

import {
	clampThinkingLevel,
	type Api,
	type Model,
} from '@earendil-works/pi-ai';
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
} from '@earendil-works/pi-coding-agent';
import { apply_project_trust_untrusted_defaults } from '@spences10/pi-project-trust';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	resolve,
} from 'node:path';
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

function resolve_agent_dir(cwd: string, agent_dir?: string): string {
	return agent_dir ? resolve(cwd, agent_dir) : getAgentDir();
}

function resolve_session_file(
	cwd: string,
	session_dir: string | undefined,
	session_ref: string | undefined,
): string | undefined {
	if (!session_ref) return undefined;
	const explicit_path = isAbsolute(session_ref)
		? session_ref
		: resolve(cwd, session_ref);
	if (existsSync(explicit_path)) return explicit_path;
	if (session_ref.endsWith('.jsonl')) return explicit_path;

	const dir = session_dir ? resolve(cwd, session_dir) : undefined;
	if (!dir || !existsSync(dir)) return undefined;
	const matches = readdirSync(dir)
		.filter(
			(file) =>
				file.endsWith('.jsonl') &&
				(basename(file, '.jsonl').endsWith(session_ref) ||
					file.includes(session_ref)),
		)
		.sort();
	const match = matches.at(-1);
	return match ? join(dir, match) : undefined;
}

function create_session_manager(options: {
	cwd: string;
	session_dir?: string;
	session?: string;
	session_id?: string;
	startup_session_name?: string;
}): SessionManager {
	const resolved_session_dir = options.session_dir
		? resolve(options.cwd, options.session_dir)
		: SessionManager.create(options.cwd).getSessionDir();
	const session_ref = options.session ?? options.session_id;
	const session_file = resolve_session_file(
		options.cwd,
		resolved_session_dir,
		session_ref,
	);
	const session_manager = session_file
		? SessionManager.open(
				session_file,
				resolved_session_dir,
				options.cwd,
			)
		: SessionManager.create(
				options.cwd,
				resolved_session_dir,
				options.session_id ? { id: options.session_id } : {},
			);
	if (
		options.startup_session_name &&
		session_manager.getSessionName() !== options.startup_session_name
	) {
		session_manager.appendSessionInfo(options.startup_session_name);
	}
	return session_manager;
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
): Set<BuiltinExtensionKey> {
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

function is_agent_dir_package_installed(
	agent_dir: string,
	package_name: string,
): boolean {
	return existsSync(
		join(agent_dir, 'npm', 'node_modules', package_name),
	);
}

export function get_externally_installed_builtin_extensions(
	agent_dir: string,
): Set<BuiltinExtensionKey> {
	const installed = new Set<BuiltinExtensionKey>();
	for (const extension of BUILTIN_EXTENSION_REGISTRY) {
		const external_package_name = (
			extension as { external_package_name?: string }
		).external_package_name;
		if (
			external_package_name &&
			is_agent_dir_package_installed(agent_dir, external_package_name)
		) {
			installed.add(extension.key);
		}
	}
	return installed;
}

function warn_builtin_extension_unavailable(
	key: BuiltinExtensionKey | 'telemetry',
	error: unknown,
): void {
	const reason =
		error instanceof Error ? error.message : String(error);
	process.emitWarning(
		`Built-in extension "${key}" is unavailable and was skipped: ${reason}`,
		{ code: 'MY_PI_BUILTIN_EXTENSION_UNAVAILABLE' },
	);
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
		try {
			const extension = await load_extension();
			await extension(pi);
		} catch (error) {
			warn_builtin_extension_unavailable(key, error);
		}
	};
}

function create_lazy_telemetry_extension(options: {
	enabled?: boolean;
	db_path?: string;
	cwd?: string;
}): ExtensionFactory {
	return async (pi) => {
		try {
			const { create_telemetry_extension } =
				await import('@spences10/pi-telemetry');
			await create_telemetry_extension(options)(pi);
		} catch (error) {
			warn_builtin_extension_unavailable('telemetry', error);
		}
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
		excluded_tools,
		selected_skills,
		session,
		session_id,
		startup_session_name,
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
	for (const key of get_externally_installed_builtin_extensions(
		effective_agent_dir,
	)) {
		force_disabled.add(key);
	}
	const builtins_config = load_builtin_extensions_config();
	const skills_builtin_enabled = is_builtin_extension_active(
		builtins_config,
		'skills',
		force_disabled,
	);
	const skills_package = skills_builtin_enabled
		? await import('@spences10/pi-skills').catch((error) => {
				warn_builtin_extension_unavailable('skills', error);
				return undefined;
			})
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
		// Keep skill filtering reloadable so profile changes made by
		// /skills are reflected without restarting the process.
		const runtime_skills_manager =
			skills_package?.create_skills_manager({
				cwd: runtime_cwd,
				project_skills_enabled: is_resource_enabled(
					process.env.MY_PI_PROJECT_SKILLS,
				),
			});
		const additional_skill_paths =
			runtime_skills_manager?.get_enabled_skill_paths() ?? [];

		const services = await createAgentSessionServices({
			cwd: runtime_cwd,
			agentDir: effective_agent_dir,
			resourceLoaderOptions: {
				...(additional_skill_paths.length
					? { additionalSkillPaths: additional_skill_paths }
					: {}),
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
					if (!runtime_skills_manager) return base;
					runtime_skills_manager.refresh();

					const selected_skill_names = selected_skills?.length
						? new Set(selected_skills)
						: undefined;
					return {
						...base,
						skills: base.skills.filter((skill: any) => {
							if (
								selected_skill_names &&
								!selected_skill_names.has(skill.name)
							) {
								return false;
							}
							return runtime_skills_manager.is_enabled_by_skill(
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
				...(excluded_tools?.length
					? { excludeTools: excluded_tools }
					: {}),
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
				sessionManager: create_session_manager({
					cwd,
					session_dir,
					session,
					session_id,
					startup_session_name,
				}),
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
} from '@earendil-works/pi-coding-agent';
