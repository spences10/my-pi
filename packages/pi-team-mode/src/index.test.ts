import { describe, expect, it } from 'vitest';
import {
	handle_team_command,
	should_inject_team_prompt,
	validate_team_tool_params,
} from './index.js';

describe('packages/pi-team-mode/src/index.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./index.js')).resolves.toBeDefined();
	});

	it('exports the peer coordination command handler', () => {
		expect(handle_team_command).toEqual(expect.any(Function));
	});

	it('injects the team prompt when the team tool is selected or tools are unspecified', () => {
		expect(should_inject_team_prompt({})).toBe(true);
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['team'] } as never,
			}),
		).toBe(true);
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['other'] } as never,
			}),
		).toBe(false);
	});

	it('validates team tool params', () => {
		expect(() =>
			validate_team_tool_params({ action: 'session_list' }),
		).not.toThrow();
		expect(() =>
			validate_team_tool_params({
				action: 'member_spawn',
				name: 'teammate-a',
			}),
		).not.toThrow();
	});
});
