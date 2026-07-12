import { describe, expect, it } from 'vitest';
import {
	TEAM_ACTIONS,
	TeamToolParams,
	validate_team_tool_params,
} from './team-tool-params.js';

describe('packages/pi-team-mode/src/team-tool-params.ts', () => {
	it('exposes peer coordination without autonomous spawn actions', () => {
		expect(TEAM_ACTIONS).toContain('session_send');
		expect(TEAM_ACTIONS).toContain('group_send');
		expect(TEAM_ACTIONS).toContain('artifact_create');
		expect(TEAM_ACTIONS).not.toContain('member_spawn' as never);
		expect(
			(
				TeamToolParams as unknown as {
					additionalProperties?: boolean;
				}
			).additionalProperties,
		).toBe(false);
	});

	it('requires a target for peer mailbox actions', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'message_send',
				message: 'hi',
			}),
		).toThrow(/to/);
		expect(() =>
			validate_team_tool_params({ action: 'message_wait' }),
		).not.toThrow();
	});

	it('rejects unknown and action-inapplicable fields', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'session_list',
				message: 'ignored',
			}),
		).toThrow(/message is not allowed/);
		expect(() =>
			validate_team_tool_params({
				action: 'session_list',
				unexpected: true,
			} as never),
		).toThrow(/unexpected is not allowed/);
	});

	it('keeps receipt actions on the caller inbox and from as the wait filter', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'message_read',
				to: 'another-session',
			}),
		).toThrow(/to is not allowed/);
		expect(() =>
			validate_team_tool_params({
				action: 'session_wait',
				from: 'worker',
				timeout_ms: 0,
			}),
		).not.toThrow();
	});
});
