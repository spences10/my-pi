import { describe, expect, it } from 'vitest';

import {
	STATIC_UMANS_CATALOG,
	create_umans_api_key_auth,
	create_umans_provider,
	normalize_umans_catalog,
	to_pi_models,
} from './index.js';

describe('umans-provider', () => {
	it('normalizes gateway model info responses', () => {
		expect(
			normalize_umans_catalog({
				data: {
					'umans-test': {
						name: 'umans-test',
						display_name: 'Umans Test',
						capabilities: {
							context_window: 123,
							supports_tools: true,
						},
					},
				},
			}),
		).toEqual({
			'umans-test': {
				name: 'umans-test',
				display_name: 'Umans Test',
				deprecation: undefined,
				capabilities: { context_window: 123, supports_tools: true },
			},
		});
	});

	it('maps Umans catalog entries to Pi models', () => {
		const models = to_pi_models(STATIC_UMANS_CATALOG);

		expect(models).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'umans-flash',
					name: 'Umans Flash',
					maxTokens: 32768,
					contextWindow: 262144,
					input: ['text', 'image'],
					supportsTools: true,
					reasoning: true,
				}),
			]),
		);
	});

	it('refreshes dynamic models without replacing the static fallback', async () => {
		const writes: unknown[] = [];
		const provider = create_umans_provider({
			env: { UMANS_API_KEY: 'env-key' },
			fetch_catalog: async (_base_url, api_key) => {
				expect(api_key).toBe('stored-key');
				return {
					'umans-live': {
						name: 'umans-live',
						display_name: 'Umans Live',
						capabilities: { context_window: 1000 },
					},
				};
			},
		});
		await provider.refreshModels!({
			credential: { type: 'api_key', key: 'stored-key' },
			allowNetwork: true,
			signal: new AbortController().signal,
			publish: async (publication) => {
				writes.push(publication.persist);
				publication.update?.();
				return true;
			},
		});

		expect(provider.getModels().map((model) => model.id)).toEqual(
			expect.arrayContaining(['umans-flash', 'umans-live']),
		);
		expect(writes).toHaveLength(1);
	});

	it('restores a stale catalog when network refresh fails', async () => {
		const stale = to_pi_models(
			{
				'umans-stale': {
					name: 'umans-stale',
					capabilities: {},
				},
			},
			'https://stale.example',
		);
		const provider = create_umans_provider({
			fetch_catalog: async () => {
				throw new Error('catalog unavailable');
			},
		});

		await expect(
			provider.refreshModels!({
				allowNetwork: true,
				signal: new AbortController().signal,
				stored: { models: stale, checkedAt: 1 },
				publish: async (publication) => {
					publication.update?.();
					return true;
				},
			}),
		).rejects.toThrow('catalog unavailable');
		expect(provider.getModels().map((model) => model.id)).toContain(
			'umans-stale',
		);
	});

	it('prefers stored API keys over environment keys', async () => {
		const auth = create_umans_api_key_auth({
			UMANS_API_KEY: 'env-key',
		});
		const ctx = {
			env: async () => undefined,
			fileExists: async () => false,
		};
		const signal = new AbortController().signal;
		await expect(
			auth.resolve({
				ctx,
				credential: { type: 'api_key', key: 'stored-key' },
				signal,
			}),
		).resolves.toEqual({
			auth: {
				headers: { authorization: 'Bearer stored-key' },
			},
			source: 'stored API key',
		});
		await expect(auth.resolve({ ctx, signal })).resolves.toEqual({
			auth: { headers: { authorization: 'Bearer env-key' } },
			source: 'UMANS_API_KEY',
		});
	});

	it('rejects empty API-key login with a useful error', async () => {
		const auth = create_umans_api_key_auth({});
		await expect(
			auth.login!({
				signal: new AbortController().signal,
				prompt: async () => '   ',
				notify: () => {},
			}),
		).rejects.toThrow('Umans API key is required');
	});

	it('does not exceed provider hard token caps', () => {
		const [model] = to_pi_models({
			capped: {
				name: 'capped',
				capabilities: {
					max_completion_tokens: 10,
					recommended_max_tokens: 20,
				},
			},
		});

		expect(model?.maxTokens).toBe(9);
	});
});
