import { describe, expect, it } from 'vitest';
import { should_skip_tool } from './context-scope.js';

describe('packages/pi-context/src/context-scope.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./context-scope.js')).resolves.toBeDefined();
	});

	it('skips recursive context tools but allows oversized Team output', () => {
		expect(should_skip_tool('context_search')).toBe(true);
		expect(should_skip_tool('team')).toBe(false);
	});
});
