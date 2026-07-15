// Composable programmatic API for my-pi

import {
	InteractiveMode,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	runPrintMode,
	runRpcMode,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	type ExtensionFactory,
	type SessionManager,
} from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';
import {
	PACKAGE_THEME_DIR,
	create_extensions_override,
	create_lazy_builtin_extension_factory,
	create_lazy_telemetry_extension,
	get_externally_installed_builtin_extensions,
	get_force_disabled_builtins,
	warn_builtin_extension_unavailable,
} from './api/builtin-extensions.js';
import {
	MY_PI_RUNTIME_MODE_ENV,
	PI_AGENT_DIR_ENV,
	apply_untrusted_repo_defaults,
	is_resource_enabled,
	resolve_agent_dir,
	restore_env,
	snapshot_env,
	wrap_runtime_env_restore,
} from './api/env.js';
import {
	resolve_effective_thinking_level,
	resolve_model_reference,
} from './api/models.js';
import type { CreateMyPiOptions } from './api/options.js';
import { create_session_manager } from './api/session.js';
import { BUILTIN_EXTENSION_REGISTRY } from './extensions/builtin-registry.js';
import {
	is_builtin_extension_active,
	load_builtin_extensions_config,
} from './extensions/manager/config.js';
import { create_extensions_extension } from './extensions/manager/index.js';

export type {
	CreateMyPiOptions,
	MyPiRuntimeMode,
	MyPiThinkingLevel,
} from './api/options.js';
export {
	apply_untrusted_repo_defaults,
	create_lazy_builtin_extension_factory,
	get_externally_installed_builtin_extensions,
	get_force_disabled_builtins,
	resolve_effective_thinking_level,
	resolve_model_reference,
};

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
		sessionStartEvent?: CreateAgentSessionFromServicesOptions['sessionStartEvent'];
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
				skillsOverride: (
					base: Parameters<
						NonNullable<
							NonNullable<
								CreateAgentSessionServicesOptions['resourceLoaderOptions']
							>['skillsOverride']
						>
					>[0],
				) => {
					if (!skills_builtin_enabled) return { ...base, skills: [] };
					if (!runtime_skills_manager) return base;
					runtime_skills_manager.refresh();

					const selected_skill_names = selected_skills?.length
						? new Set(selected_skills)
						: undefined;
					return {
						...base,
						skills: base.skills.filter((skill) => {
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
			} satisfies CreateAgentSessionServicesOptions['resourceLoaderOptions'],
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
				sessionStartEvent,
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
