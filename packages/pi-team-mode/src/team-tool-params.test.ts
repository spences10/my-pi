import { describe, expect, it } from 'vitest';
import {
	TEAM_ACTIONS,
	TeamToolParams,
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
		expect(
			(
				TeamToolParams as unknown as {
					additionalProperties?: boolean;
				}
			).additionalProperties,
		).toBe(false);
		expect(TEAM_ACTIONS).not.toContain('team_create' as any);
		expect(TEAM_ACTIONS).not.toContain('task_create' as any);
	});

	it('requires a name for visible teammate spawning', () => {
		expect(() =>
			validate_team_tool_params({ action: 'member_spawn' }),
		).toThrow(/name/);
		expect(() =>
			validate_team_tool_params({
				action: 'member_spawn',
				name: 'fast-check',
				command: 'pnpm test',
			}),
		).not.toThrow();
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
			} as any),
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
