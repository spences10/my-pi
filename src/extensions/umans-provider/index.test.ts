import { describe, expect, it } from 'vitest';

import {
	STATIC_UMANS_CATALOG,
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
