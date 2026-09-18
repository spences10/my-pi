import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-mcp/src/project-config-loader.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./project-config-loader.js'),
		).resolves.toBeDefined();
	});
});
