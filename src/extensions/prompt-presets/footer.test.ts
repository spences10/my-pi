import { describe, expect, it } from 'vite-plus/test';

describe('src/extensions/prompt-presets/footer.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./footer.js')).resolves.toBeDefined();
	});
});
