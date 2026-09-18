import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-lsp/src/tools.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./tools.js')).resolves.toBeDefined();
	});
});
