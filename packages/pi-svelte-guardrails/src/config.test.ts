import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-svelte-guardrails/src/config.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./config.js')).resolves.toBeDefined();
	});
});
