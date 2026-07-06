import { describe, expect, it } from 'vitest';
import {
	TEAM_ACTIONS,
	validate_team_tool_params,
} from './team-tool-params.js';

describe('packages/pi-team-mode/src/team-tool-params.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./team-tool-params.js'),
		).resolves.toBeDefined();
	});

	it('exposes visible teammate spawning but not RPC task actions', () => {
		expect(TEAM_ACTIONS).toContain('member_spawn');
		expect(TEAM_ACTIONS).not.toContain('team_create' as any);
		expect(TEAM_ACTIONS).not.toContain('task_create' as any);
	});

	it('requires a name for visible teammate spawning', () => {
		expect(() =>
			validate_team_tool_params({ action: 'member_spawn' }),
		).toThrow(/name/);
	});

	it('requires a target for peer mailbox actions', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'message_send',
				message: 'hi',
			}),
		).toThrow(/to/);
	});
});
