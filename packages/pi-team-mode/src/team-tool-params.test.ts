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

	it('accepts bounded list pagination, scope, and inbox filters', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'session_list',
				global: true,
				include_offline: true,
				limit: 25,
				offset: 50,
			}),
		).not.toThrow();
		expect(() =>
			validate_team_tool_params({
				action: 'message_list',
				from: 'reviewer',
				unread_only: true,
				unacknowledged_only: true,
				limit: 5,
			}),
		).not.toThrow();
		expect(() =>
			validate_team_tool_params({
				action: 'artifact_list',
				global: true,
				limit: 100,
			}),
		).not.toThrow();
	});

	it('rejects invalid pages and contradictory inbox state filters', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'group_list',
				limit: 101,
			}),
		).toThrow(/limit/);
		expect(() =>
			validate_team_tool_params({
				action: 'artifact_list',
				offset: 1.5,
			}),
		).toThrow(/offset/);
		expect(() =>
			validate_team_tool_params({
				action: 'session_inbox',
				include_read: true,
				unread_only: true,
			}),
		).toThrow(/cannot be combined/);
		expect(() =>
			validate_team_tool_params({
				action: 'message_list',
				include_acknowledged: true,
				unacknowledged_only: true,
			}),
		).toThrow(/cannot be combined/);
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
