import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/git/errors.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./errors.js')).resolves.toBeDefined();
	});
});
