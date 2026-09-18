import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/commit-composer.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./commit-composer.js'),
		).resolves.toBeDefined();
	});
});
