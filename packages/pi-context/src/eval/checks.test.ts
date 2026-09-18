import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/eval/checks.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./checks.js')).resolves.toBeDefined();
	});
});
