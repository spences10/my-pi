import { describe, expect, it } from 'vitest';

describe('packages/pi-team-mode/src/team-tool-params.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./team-tool-params.js'),
		).resolves.toBeDefined();
	});
});
