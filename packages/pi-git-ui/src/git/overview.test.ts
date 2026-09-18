import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/git/overview.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./overview.js')).resolves.toBeDefined();
	});
});
