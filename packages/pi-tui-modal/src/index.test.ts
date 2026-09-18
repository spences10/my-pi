import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-tui-modal/src/index.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./index.js')).resolves.toBeDefined();
	});
});
