import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-mcp/src/backup-restore.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./backup-restore.js'),
		).resolves.toBeDefined();
	});
});
