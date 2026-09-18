import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/eval/fixtures.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./fixtures.js')).resolves.toBeDefined();
	});
});
