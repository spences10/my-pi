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

	it('does not expose RPC teammate or task actions', () => {
		expect(TEAM_ACTIONS).not.toContain('member_spawn' as any);
		expect(TEAM_ACTIONS).not.toContain('team_create' as any);
		expect(TEAM_ACTIONS).not.toContain('task_create' as any);
	});

	it('requires a target for peer mailbox actions', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'message_send',
				message: 'hi',
			}),
		).toThrow(/to/);
	});

	it('validates session_open alias requirements', () => {
		expect(TEAM_ACTIONS).toContain('session_open');
		expect(() =>
			validate_team_tool_params({ action: 'session_open' }),
		).toThrow(/member/);
		expect(() =>
			validate_team_tool_params({
				action: 'session_open',
				member: 'worker',
			}),
		).not.toThrow();
	});
});
