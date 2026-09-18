import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/git/diff.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./diff.js')).resolves.toBeDefined();
	});
});
