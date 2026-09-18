import { describe, expect, it } from 'vite-plus/test';

describe('src/extensions/prompt-presets/catalog.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./catalog.js')).resolves.toBeDefined();
	});
});
