import { describe, expect, it } from 'vitest';

describe('src/extensions/prompt-presets/defaults.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./defaults.js')).resolves.toBeDefined();
	});

	it('includes the working-style layers', async () => {
		const { DEFAULT_PROMPT_PRESETS } = await import('./defaults.js');

		expect(DEFAULT_PROMPT_PRESETS.spence).toMatchObject({
			kind: 'layer',
			description:
				'Discuss critically, then execute the agreed outcome autonomously',
		});
		expect(DEFAULT_PROMPT_PRESETS['asd-ste100']).toMatchObject({
			kind: 'layer',
			description: 'Use ASD-STE100 Simplified Technical English',
		});
	});
});
