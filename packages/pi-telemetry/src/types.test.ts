import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-telemetry/src/types.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./types.js')).resolves.toBeDefined();
	});
});
