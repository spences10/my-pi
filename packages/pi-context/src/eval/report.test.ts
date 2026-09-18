import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-context/src/eval/report.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./report.js')).resolves.toBeDefined();
	});
});
