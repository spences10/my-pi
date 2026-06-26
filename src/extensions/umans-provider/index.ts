import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from '@earendil-works/pi-ai';
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
): Promise<Record<string, UmansModelInfo>> {
	const headers: Record<string, string> = {
		'user-agent': USER_AGENT,
	};
	if (api_key) headers.authorization = `Bearer ${api_key}`;

	const response = await fetch(
		`${base_url.replace(/\/$/, '')}/v1/models/info`,
		{ headers },
	);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return normalize_umans_catalog(await response.json());
}

export function to_pi_models(
	catalog: Record<string, UmansModelInfo>,
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

async function login_umans(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	const api_key = await callbacks.onPrompt({
		message: 'Enter your Umans API key:',
	});
	const key = api_key.trim();
	if (!key) throw new Error('Umans API key is required');
	return {
		refresh: key,
		access: key,
		expires: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
	};
}

const extension: ExtensionFactory = async (pi) => {
	if (process.env.UMANS_DISABLE === '1') return;

	const base_url =
		process.env.UMANS_BASE_URL?.trim() || DEFAULT_BASE_URL;
	let catalog = STATIC_UMANS_CATALOG;
	try {
		const live_catalog = await fetch_umans_catalog(
			base_url,
			process.env[API_KEY_ENV],
		);
		if (Object.keys(live_catalog).length > 0) catalog = live_catalog;
	} catch {
		catalog = STATIC_UMANS_CATALOG;
	}

	pi.registerProvider('umans', {
		name: 'Umans',
		baseUrl: base_url,
		apiKey: `$${API_KEY_ENV}`,
		api: 'anthropic-messages',
		authHeader: true,
		models: to_pi_models(catalog),
		oauth: {
			name: 'Umans',
			login: login_umans,
			refreshToken: (credentials: OAuthCredentials) =>
				Promise.resolve(credentials),
			getApiKey: (credentials: OAuthCredentials) =>
				credentials.access,
		},
	});
};

export default extension;
