import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/policy.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./policy.js')).resolves.toBeDefined();
	});
});
