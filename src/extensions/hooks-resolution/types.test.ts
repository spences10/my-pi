import { describe, expect, it } from 'vite-plus/test';

describe('src/extensions/hooks-resolution/types.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./types.js')).resolves.toBeDefined();
	});
});
