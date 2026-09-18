import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-telemetry/src/store-loader.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./store-loader.js')).resolves.toBeDefined();
	});
});
