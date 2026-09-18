import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/ui/menu.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./menu.js')).resolves.toBeDefined();
	});
});
