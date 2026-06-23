import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { load_settings } from '../../settings/index.js';

export const DEFAULT_FUSION_ANALYSIS_MODELS = [
	'~openai/gpt-latest',
	'~google/gemini-pro-latest',
	'deepseek/deepseek-v3.2',
	'~moonshotai/kimi-latest',
] as const;

export const DEFAULT_FUSION_JUDGE_MODEL = '~openai/gpt-latest';

const FUSION_MODEL_ID = 'openrouter/fusion';
const FUSION_PLUGIN_ID = 'fusion';

export interface FusionPluginConfig {
	id: 'fusion';
	analysis_models: string[];
	model: string;
}

export interface OpenRouterFusionSettings {
	analysisModels?: string[];
	judgeModel?: string;
	force?: boolean;
}

export interface FusionRequestConfig {
	plugin: FusionPluginConfig;
	force: boolean;
}

function split_models(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((model) => model.trim())
		.filter(Boolean);
}

function string_array(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function env_flag(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return undefined;
}

export function get_fusion_request_config(
	options: {
		settings?: OpenRouterFusionSettings;
		env?: NodeJS.ProcessEnv;
	} = {},
): FusionRequestConfig {
	const env = options.env ?? process.env;
	const settings =
		options.settings ?? load_settings().openRouterFusion ?? {};
	const env_models = split_models(env.MY_PI_FUSION_ANALYSIS_MODELS);

	return {
		plugin: {
			id: FUSION_PLUGIN_ID,
			analysis_models:
				env_models.length > 0
					? env_models
					: (string_array(settings.analysisModels) ?? [
							...DEFAULT_FUSION_ANALYSIS_MODELS,
						]),
			model:
				env.MY_PI_FUSION_JUDGE_MODEL?.trim() ||
				settings.judgeModel?.trim() ||
				DEFAULT_FUSION_JUDGE_MODEL,
		},
		force: env_flag(env.MY_PI_FUSION_FORCE) ?? settings.force ?? true,
	};
}

export function get_fusion_plugin_config(
	options: {
		settings?: OpenRouterFusionSettings;
		env?: NodeJS.ProcessEnv;
	} = {},
): FusionPluginConfig {
	return get_fusion_request_config(options).plugin;
}

export function apply_fusion_config_plugin(
	payload: unknown,
	config: FusionRequestConfig,
): unknown {
	if (!payload || typeof payload !== 'object') return undefined;

	const request = payload as Record<string, unknown>;
	if (request.model !== FUSION_MODEL_ID) return undefined;

	const plugins = Array.isArray(request.plugins)
		? request.plugins
		: [];
	const next_plugins = [
		...plugins.filter(
			(plugin) =>
				!plugin ||
				typeof plugin !== 'object' ||
				(plugin as Record<string, unknown>).id !== FUSION_PLUGIN_ID,
		),
		config.plugin,
	];

	return {
		...request,
		plugins: next_plugins,
		...(config.force ? { tool_choice: 'required' } : {}),
	};
}

const extension: ExtensionFactory = (pi) => {
	pi.on('before_provider_request', (event) =>
		apply_fusion_config_plugin(
			event.payload,
			get_fusion_request_config(),
		),
	);
};

export default extension;
