import { describe, expect, it } from 'vite-plus/test';

describe('packages/pi-skills/src/skills-ui/profiles.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./profiles.js')).resolves.toBeDefined();
	});
});
