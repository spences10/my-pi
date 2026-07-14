import { describe, expect, it } from 'vitest';

describe('src/extensions/prompt-presets/defaults.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./defaults.js')).resolves.toBeDefined();
	});

	it('includes the spence working-style layer', async () => {
		const { DEFAULT_PROMPT_PRESETS } = await import('./defaults.js');

		expect(DEFAULT_PROMPT_PRESETS.spence).toMatchObject({
			kind: 'layer',
			description:
				'Discuss critically, then execute the agreed outcome autonomously',
		});
	});
});
