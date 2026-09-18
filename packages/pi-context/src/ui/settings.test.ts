import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/ui/settings.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./settings.js')).resolves.toBeDefined();
	});
});
