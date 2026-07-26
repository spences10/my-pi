import {
	createProvider,
	type ApiKeyAuth,
	type AuthInteraction,
	type Credential,
	type OAuthAuth,
	type OAuthCredential,
	type Provider,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

const DEFAULT_BASE_URL = 'https://api.code.umans.ai';
const API_KEY_ENV = 'UMANS_API_KEY';
const USER_AGENT = 'my-pi-umans-provider/0.1.0';

interface ReasoningInfo {
	supported: boolean;
	can_disable: boolean;
	levels: string[];
	default_level: string;
}

interface ModelCapabilities {
	max_completion_tokens?: number;
	recommended_max_tokens?: number;
	context_window?: number;
	supports_vision?: boolean | 'via-handoff';
	supports_tools?: boolean;
	reasoning?: ReasoningInfo;
}

interface UmansModelInfo {
	name: string;
	display_name?: string;
	deprecation?: unknown;
	capabilities: ModelCapabilities;
}

export const STATIC_UMANS_CATALOG: Record<string, UmansModelInfo> = {
	'umans-kimi-k2.6': {
		name: 'umans-kimi-k2.6',
		display_name: 'Umans Kimi K2.6',
		capabilities: {
			max_completion_tokens: 262144,
			recommended_max_tokens: 32768,
			context_window: 262144,
			supports_vision: true,
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: true,
				levels: [
					'none',
					'minimal',
					'low',
					'medium',
					'high',
					'xhigh',
					'max',
				],
				default_level: 'medium',
			},
		},
	},
	'umans-kimi-k2.7': {
		name: 'umans-kimi-k2.7',
		display_name: 'Umans Kimi K2.7 Code',
		capabilities: {
			max_completion_tokens: 262144,
			recommended_max_tokens: 32768,
			context_window: 262144,
			supports_vision: true,
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: false,
				levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
				default_level: 'medium',
			},
		},
	},
	'umans-glm-5.2': {
		name: 'umans-glm-5.2',
		display_name: 'Umans GLM 5.2',
		capabilities: {
			max_completion_tokens: 131072,
			recommended_max_tokens: 131071,
			context_window: 405504,
			supports_vision: 'via-handoff',
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: true,
				levels: [
					'none',
					'minimal',
					'low',
					'medium',
					'high',
					'xhigh',
					'max',
				],
				default_level: 'medium',
			},
		},
	},
	'umans-coder': {
		name: 'umans-coder',
		display_name: 'Umans Coder',
		capabilities: {
			max_completion_tokens: 262144,
			recommended_max_tokens: 32768,
			context_window: 262144,
			supports_vision: true,
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: false,
				levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
				default_level: 'medium',
			},
		},
	},
	'umans-flash': {
		name: 'umans-flash',
		display_name: 'Umans Flash',
		capabilities: {
			max_completion_tokens: 262144,
			recommended_max_tokens: 32768,
			context_window: 262144,
			supports_vision: true,
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: true,
				levels: [
					'none',
					'minimal',
					'low',
					'medium',
					'high',
					'xhigh',
					'max',
				],
				default_level: 'medium',
			},
		},
	},
	'umans-qwen3.6-35b-a3b': {
		name: 'umans-qwen3.6-35b-a3b',
		display_name: 'Umans Qwen3.6 35B A3B',
		capabilities: {
			max_completion_tokens: 262144,
			recommended_max_tokens: 32768,
			context_window: 262144,
			supports_vision: true,
			supports_tools: true,
			reasoning: {
				supported: true,
				can_disable: true,
				levels: [
					'none',
					'minimal',
					'low',
					'medium',
					'high',
					'xhigh',
					'max',
				],
				default_level: 'medium',
			},
		},
	},
};

function safe_max_tokens(recommended?: number, cap?: number): number {
	let value =
		typeof recommended === 'number' && recommended > 0
			? recommended
			: 32768;
	if (typeof cap === 'number' && cap > 0)
		value = Math.min(value, cap - 1);
	return Math.max(value, 1);
}

function is_record(value: unknown): value is Record<string, unknown> {
	return (
		!!value && typeof value === 'object' && !Array.isArray(value)
	);
}

export function normalize_umans_catalog(
	value: unknown,
): Record<string, UmansModelInfo> {
	const source =
		is_record(value) && is_record(value.data) ? value.data : value;
	if (!is_record(source)) return {};

	const catalog: Record<string, UmansModelInfo> = {};
	for (const [id, info] of Object.entries(source)) {
		if (!is_record(info)) continue;
		const capabilities = is_record(info.capabilities)
			? info.capabilities
			: {};
		catalog[id] = {
			name: typeof info.name === 'string' ? info.name : id,
			display_name:
				typeof info.display_name === 'string'
					? info.display_name
					: id,
			deprecation: info.deprecation,
			capabilities: capabilities as ModelCapabilities,
		};
	}
	return catalog;
}

export async function fetch_umans_catalog(
	base_url: string,
	api_key?: string,
	signal?: AbortSignal,
): Promise<Record<string, UmansModelInfo>> {
	const headers: Record<string, string> = {
		'user-agent': USER_AGENT,
	};
	if (api_key) headers.authorization = `Bearer ${api_key}`;

	const response = await fetch(
		`${base_url.replace(/\/$/, '')}/v1/models/info`,
		{ headers, signal },
	);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return normalize_umans_catalog(await response.json());
}

export function to_pi_models(
	catalog: Record<string, UmansModelInfo>,
	base_url = DEFAULT_BASE_URL,
) {
	return Object.entries(catalog)
		.filter(([, info]) => !info.deprecation)
		.map(([id, info]) => {
			const capabilities = info.capabilities ?? {};
			const input: ('text' | 'image')[] = capabilities.supports_vision
				? ['text', 'image']
				: ['text'];
			return {
				id,
				name: info.display_name ?? id,
				api: 'anthropic-messages' as const,
				provider: 'umans',
				baseUrl: base_url,
				maxTokens: safe_max_tokens(
					capabilities.recommended_max_tokens,
					capabilities.max_completion_tokens,
				),
				contextWindow: capabilities.context_window ?? 262144,
				reasoning: capabilities.reasoning?.supported === true,
				input,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				supportsTools: capabilities.supports_tools !== false,
			};
		});
}

async function prompt_for_api_key(
	interaction: AuthInteraction,
): Promise<string> {
	const api_key = await interaction.prompt({
		type: 'secret',
		message: 'Enter your Umans API key:',
	});
	const key = api_key.trim();
	if (!key) throw new Error('Umans API key is required');
	return key;
}

function bearer_auth(key: string) {
	return {
		auth: { headers: { authorization: `Bearer ${key}` } },
	};
}

export function create_umans_api_key_auth(
	env: NodeJS.ProcessEnv = process.env,
): ApiKeyAuth {
	return {
		name: 'Umans API key',
		async login(interaction) {
			return {
				type: 'api_key',
				key: await prompt_for_api_key(interaction),
			};
		},
		async check({ credential }) {
			if (credential?.key)
				return { type: 'api_key', source: 'stored API key' };
			if (env[API_KEY_ENV]?.trim())
				return { type: 'api_key', source: API_KEY_ENV };
			return undefined;
		},
		async resolve({ credential }) {
			const stored_key = credential?.key?.trim();
			if (stored_key)
				return {
					...bearer_auth(stored_key),
					source: 'stored API key',
				};
			const env_key = env[API_KEY_ENV]?.trim();
			return env_key
				? { ...bearer_auth(env_key), source: API_KEY_ENV }
				: undefined;
		},
	};
}

function create_legacy_umans_oauth(): OAuthAuth {
	return {
		name: 'Legacy Umans credential',
		loginLabel: 'Enter Umans API key (legacy credential)',
		async login(interaction): Promise<OAuthCredential> {
			const key = await prompt_for_api_key(interaction);
			return {
				type: 'oauth',
				refresh: key,
				access: key,
				expires: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
			};
		},
		refresh: (credential) => Promise.resolve(credential),
		toAuth: async (credential) => bearer_auth(credential.access).auth,
	};
}

function credential_key(
	credential: Credential | undefined,
	env: NodeJS.ProcessEnv,
): string | undefined {
	if (credential?.type === 'api_key') return credential.key?.trim();
	if (credential?.type === 'oauth') return credential.access.trim();
	return env[API_KEY_ENV]?.trim() || undefined;
}

export interface CreateUmansProviderOptions {
	base_url?: string;
	env?: NodeJS.ProcessEnv;
	fetch_catalog?: typeof fetch_umans_catalog;
}

export function create_umans_provider(
	options: CreateUmansProviderOptions = {},
): Provider<'anthropic-messages'> {
	const env = options.env ?? process.env;
	const base_url =
		options.base_url?.trim() ||
		env.UMANS_BASE_URL?.trim() ||
		DEFAULT_BASE_URL;
	const fetch_catalog = options.fetch_catalog ?? fetch_umans_catalog;
	return createProvider({
		id: 'umans',
		name: 'Umans',
		baseUrl: base_url,
		auth: {
			apiKey: create_umans_api_key_auth(env),
			oauth: create_legacy_umans_oauth(),
		},
		models: to_pi_models(STATIC_UMANS_CATALOG, base_url),
		async fetchModels(context) {
			const catalog = await fetch_catalog(
				base_url,
				credential_key(context.credential, env),
				context.signal,
			);
			return to_pi_models(catalog, base_url);
		},
		api: anthropicMessagesApi(),
	});
}

const extension: ExtensionFactory = (pi) => {
	if (process.env.UMANS_DISABLE === '1') return;
	pi.registerProvider(create_umans_provider());
};

export default extension;
