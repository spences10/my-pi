import { describe, expect, it } from 'vitest';
import { should_inject_recall_prompt } from './index.js';

describe('should_inject_recall_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_recall_prompt({ systemPromptOptions: {} } as any),
		).toBe(true);
	});

	it('injects when bash is active', () => {
		expect(
			should_inject_recall_prompt({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as any),
		).toBe(true);
	});

	it('skips injection when bash is unavailable', () => {
		expect(
			should_inject_recall_prompt({
				systemPromptOptions: { selectedTools: ['read', 'write'] },
			} as any),
		).toBe(false);
	});
});
