import { describe, expect, it } from 'vitest';
import { should_inject_handoff_prompt } from './index.js';

describe('pi-handoff prompt shim', () => {
	it('injects when tools are unrestricted', () => {
		expect(should_inject_handoff_prompt({})).toBe(true);
	});

	it('injects when write or team tools are available', () => {
		expect(
			should_inject_handoff_prompt({
				systemPromptOptions: { selectedTools: ['write'] },
			}),
		).toBe(true);
		expect(
			should_inject_handoff_prompt({
				systemPromptOptions: { selectedTools: ['team'] },
			}),
		).toBe(true);
	});

	it('skips when neither artifact nor team tools are available', () => {
		expect(
			should_inject_handoff_prompt({
				systemPromptOptions: { selectedTools: ['read'] },
			}),
		).toBe(false);
	});
});
