import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/git/client.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./client.js')).resolves.toBeDefined();
	});
});
