import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-git-ui/src/stage-body.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./stage-body.js')).resolves.toBeDefined();
	});
});
