import { describe, expect, it } from 'vitest';
import { should_inject_team_prompt } from './index.js';

describe('team prompt shim', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_team_prompt({ systemPromptOptions: {} as any }),
		).toBe(true);
	});

	it('injects when the team tool is selected', () => {
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['team'] } as any,
			}),
		).toBe(true);
	});

	it('does not inject when the team tool is not selected', () => {
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['bash'] } as any,
			}),
		).toBe(false);
	});
});
