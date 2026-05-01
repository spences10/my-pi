import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	find_shared_mutating_conflict,
	find_worktree_assignment_conflict,
	format_completed_task_results,
	format_team_dashboard,
	get_team_ui_mode,
	get_team_ui_style,
	handle_team_command,
	require_lead_for_teammate_spawn,
	should_inject_team_prompt,
	should_show_team_widget,
	validate_team_tool_params,
} from './index.js';
import { capture_process_identity } from './process-identity.js';
import { TeamStore, type TeamStatus } from './store.js';
import { TeamToolParams } from './team-tool-params.js';

const original_team_ui = process.env.MY_PI_TEAM_UI;
const original_team_ui_style = process.env.MY_PI_TEAM_UI_STYLE;

afterEach(() => {
	if (original_team_ui === undefined)
		delete process.env.MY_PI_TEAM_UI;
	else process.env.MY_PI_TEAM_UI = original_team_ui;

	if (original_team_ui_style === undefined)
		delete process.env.MY_PI_TEAM_UI_STYLE;
	else process.env.MY_PI_TEAM_UI_STYLE = original_team_ui_style;
});

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

function test_status(
	task_count: number,
	counts?: Partial<TeamStatus['counts']>,
): TeamStatus {
	return {
		team: {
			version: 1,
			id: 'team-1',
			name: 'team',
			cwd: process.cwd(),
			created_at: '2026-04-30T00:00:00.000Z',
			updated_at: '2026-04-30T00:00:00.000Z',
			next_task_id: 1,
		},
		members: [],
		tasks: Array.from({ length: task_count }, (_, index) => ({
			id: String(index + 1),
			title: `Task ${index + 1}`,
			status: 'completed',
			depends_on: [],
			created_at: '2026-04-30T00:00:00.000Z',
			updated_at: '2026-04-30T00:00:00.000Z',
		})),
		counts: {
			pending: 0,
			in_progress: 0,
			blocked: 0,
			completed: task_count,
			cancelled: 0,
			...counts,
		},
	};
}

describe('team tool validation', () => {
	it('uses a top-level object schema for provider compatibility', () => {
		const schema = TeamToolParams as unknown as {
			type: string;
			properties: { action: { type: string; enum: string[] } };
		};

		expect(schema.type).toBe('object');
		expect(schema.properties.action.type).toBe('string');
		expect(schema.properties.action.enum).toContain('member_spawn');
	});

	const optional_only_actions = [
		'team_create',
		'team_list',
		'team_status',
		'team_clear',
		'team_ui',
		'member_status',
		'task_list',
	] as const;

	for (const action of optional_only_actions) {
		it(`accepts ${action} without action-specific fields`, () => {
			expect(() =>
				validate_team_tool_params({ action }),
			).not.toThrow();
		});
	}

	const missing_required_cases = [
		['member_upsert', /member/],
		['member_spawn', /member/],
		['member_prompt', /member/],
		['member_follow_up', /member/],
		['member_steer', /member/],
		['member_shutdown', /member/],
		['member_wait', /member/],
		['task_create', /title/],
		['task_get', /task_id/],
		['task_update', /task_id/],
		['task_claim_next', /assignee/],
		['message_send', /to/],
		['message_list', /member/],
		['message_read', /member/],
		['message_ack', /member/],
	] as const;

	for (const [action, field_match] of missing_required_cases) {
		it(`rejects ${action} without required fields`, () => {
			expect(() => validate_team_tool_params({ action })).toThrow(
				new RegExp(
					`Invalid team tool action ${action}:.*${field_match.source}`,
				),
			);
		});
	}

	it('accepts legacy aliases for member and prompt fields', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'member_prompt',
				name: 'alice',
				initial_prompt: 'go',
			}),
		).not.toThrow();
		expect(() =>
			validate_team_tool_params({
				action: 'task_claim_next',
				member: 'alice',
			}),
		).not.toThrow();
		expect(() =>
			validate_team_tool_params({
				action: 'message_ack',
				to: 'alice',
			}),
		).not.toThrow();
	});
});

describe('nested team spawn guard', () => {
	it('rejects teammate-role spawn attempts with a clear error', () => {
		expect(() => require_lead_for_teammate_spawn('teammate')).toThrow(
			/Only team leads can spawn teammates/,
		);
	});

	it('allows lead and unset roles to spawn teammates', () => {
		expect(() =>
			require_lead_for_teammate_spawn('lead'),
		).not.toThrow();
		expect(() =>
			require_lead_for_teammate_spawn(undefined),
		).not.toThrow();
	});

	it('rejects /team spawn from teammate-role command sessions', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-team-index-'));
		try {
			const store = new TeamStore(root);
			const notifications: string[] = [];
			await handle_team_command(
				'spawn bob',
				{
					cwd: '/repo',
					hasUI: false,
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				store,
				new Map(),
				() => 'team-1',
				() => undefined,
				'teammate',
			);

			expect(notifications.join('\n')).toMatch(
				/Only team leads can spawn teammates/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('mailbox commands', () => {
	it('marks selected messages read and acknowledged without acking the whole inbox', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-team-mailbox-'));
		try {
			const store = new TeamStore(root);
			const team = store.create_team({ cwd: '/repo' });
			const first = await store.send_message(team.id, {
				from: 'lead',
				to: 'alice',
				body: 'first',
			});
			const second = await store.send_message(team.id, {
				from: 'lead',
				to: 'alice',
				body: 'second',
			});
			const notifications: string[] = [];
			const ctx = {
				cwd: '/repo',
				hasUI: false,
				ui: {
					notify: (message: string) => notifications.push(message),
				},
			} as any;

			await handle_team_command(
				`inbox alice read ${first.id}`,
				ctx,
				store,
				new Map(),
				() => team.id,
				() => undefined,
				'lead',
			);
			await handle_team_command(
				`ack alice ${second.id}`,
				ctx,
				store,
				new Map(),
				() => team.id,
				() => undefined,
				'lead',
			);

			const messages = store.list_messages(team.id, 'alice');
			expect(
				messages.find((message) => message.id === first.id),
			).toMatchObject({
				read_at: expect.any(String),
			});
			expect(
				messages.find((message) => message.id === first.id)
					?.acknowledged_at,
			).toBeUndefined();
			expect(
				messages.find((message) => message.id === second.id),
			).toMatchObject({
				acknowledged_at: expect.any(String),
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('orphaned teammate recovery', () => {
	it('terminates a live persisted teammate pid after lead restart', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-team-orphan-'));
		const child = spawn(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			{ stdio: 'ignore' },
		);
		try {
			const store = new TeamStore(root);
			const team = store.create_team({ cwd: '/repo' });
			await store.upsert_member(team.id, {
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				pid: child.pid,
				process_identity: child.pid
					? capture_process_identity(child.pid)
					: undefined,
			});
			const notifications: string[] = [];

			expect((await store.get_status(team.id)).members).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'alice',
						status: 'running_orphaned',
					}),
				]),
			);

			await handle_team_command(
				'shutdown alice',
				{
					cwd: '/repo',
					hasUI: false,
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				store,
				new Map(),
				() => team.id,
				() => undefined,
				'lead',
			);

			expect(notifications.join('\n')).toMatch(
				/Terminated orphaned teammate alice/,
			);
			expect(store.list_members(team.id)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'alice',
						status: 'offline',
					}),
				]),
			);
		} finally {
			if (child.pid) {
				try {
					process.kill(child.pid, 'SIGKILL');
				} catch {
					// Already stopped by the command under test.
				}
			}
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('worktree assignment guard', () => {
	it('finds active teammates using the same worktree path', () => {
		expect(
			find_worktree_assignment_conflict(
				[
					{
						name: 'alice',
						role: 'teammate',
						status: 'idle',
						cwd: '/repo/.worktrees/alice',
						workspace_mode: 'worktree',
						worktree_path: '/repo/.worktrees/alice',
						branch: 'team/alice',
						last_seen_at: '2026-04-30T00:00:00.000Z',
						created_at: '2026-04-30T00:00:00.000Z',
						updated_at: '2026-04-30T00:00:00.000Z',
					},
				],
				{
					cwd: '/repo/.worktrees/alice',
					workspace_mode: 'worktree',
					worktree_path: '/repo/.worktrees/alice',
					branch: 'team/bob',
				},
			),
		).toMatchObject({ name: 'alice' });
	});

	it('finds active teammates using the same worktree branch', () => {
		expect(
			find_worktree_assignment_conflict(
				[
					{
						name: 'alice',
						role: 'teammate',
						status: 'running',
						cwd: '/repo/.worktrees/alice',
						workspace_mode: 'worktree',
						worktree_path: '/repo/.worktrees/alice',
						branch: 'team/shared',
						last_seen_at: '2026-04-30T00:00:00.000Z',
						created_at: '2026-04-30T00:00:00.000Z',
						updated_at: '2026-04-30T00:00:00.000Z',
					},
				],
				{
					cwd: '/repo/.worktrees/bob',
					workspace_mode: 'worktree',
					worktree_path: '/repo/.worktrees/bob',
					branch: 'team/shared',
				},
			),
		).toMatchObject({ name: 'alice' });
	});

	it('ignores offline worktree assignments', () => {
		expect(
			find_worktree_assignment_conflict(
				[
					{
						name: 'alice',
						role: 'teammate',
						status: 'offline',
						cwd: '/repo/.worktrees/alice',
						workspace_mode: 'worktree',
						worktree_path: '/repo/.worktrees/alice',
						branch: 'team/alice',
						last_seen_at: '2026-04-30T00:00:00.000Z',
						created_at: '2026-04-30T00:00:00.000Z',
						updated_at: '2026-04-30T00:00:00.000Z',
					},
				],
				{
					cwd: '/repo/.worktrees/alice',
					workspace_mode: 'worktree',
					worktree_path: '/repo/.worktrees/alice',
					branch: 'team/alice',
				},
			),
		).toBeUndefined();
	});
});

describe('shared mutating workspace guard', () => {
	it('finds active mutating teammates in the same shared cwd', () => {
		expect(
			find_shared_mutating_conflict(
				[
					{
						name: 'alice',
						role: 'teammate',
						status: 'running',
						cwd: '/repo',
						workspace_mode: 'shared',
						mutating: true,
						last_seen_at: '2026-04-30T00:00:00.000Z',
						created_at: '2026-04-30T00:00:00.000Z',
						updated_at: '2026-04-30T00:00:00.000Z',
					},
					{
						name: 'bob',
						role: 'teammate',
						status: 'running',
						cwd: '/repo/.worktrees/bob',
						workspace_mode: 'worktree',
						mutating: true,
						last_seen_at: '2026-04-30T00:00:00.000Z',
						created_at: '2026-04-30T00:00:00.000Z',
						updated_at: '2026-04-30T00:00:00.000Z',
					},
				],
				'/repo/',
				'charlie',
			),
		).toMatchObject({ name: 'alice' });
	});
});

describe('team dashboard', () => {
	it('formats members, task groups, mailboxes, transcripts, and usage', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-team-dashboard-'));
		try {
			const store = new TeamStore(root);
			const team = store.create_team({ cwd: '/repo' });
			const session_file = join(root, 'alice-session.jsonl');
			writeFileSync(
				session_file,
				[
					JSON.stringify({ type: 'session', version: 3 }),
					JSON.stringify({
						type: 'message',
						message: {
							role: 'assistant',
							model: 'claude-test',
							usage: {
								totalTokens: 1200,
								cost: { total: 0.034 },
							},
						},
					}),
				].join('\n'),
			);
			await store.upsert_member(team.id, {
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				model: 'anthropic/claude-test',
				pid: 123,
				session_file,
			});
			await store.create_task(team.id, {
				title: 'Blocked thing',
				assignee: 'alice',
				status: 'blocked',
			});
			const done = await store.create_task(team.id, {
				title: 'Finished thing',
				assignee: 'alice',
			});
			await store.update_task(team.id, done.id, {
				status: 'completed',
				result: 'Implemented the thing.\nMore detail.',
			});
			await store.send_message(team.id, {
				from: 'lead',
				to: 'alice',
				body: 'Please check in',
				urgent: true,
			});

			const notifications: string[] = [];
			await handle_team_command(
				'dashboard',
				{
					cwd: '/repo',
					hasUI: false,
					ui: {
						notify: (message: string) => notifications.push(message),
					},
				} as any,
				store,
				new Map(),
				() => team.id,
				() => undefined,
				'lead',
			);

			const dashboard = notifications.join('\n');
			expect(dashboard).toContain('Team dashboard:');
			expect(dashboard).toContain(`transcript ${session_file}`);
			expect(dashboard).toContain('1.2k tokens');
			expect(dashboard).toContain('$0.03');
			expect(dashboard).toContain('Needs attention (1)');
			expect(dashboard).toContain('Completed work (1)');
			expect(dashboard).toContain(
				'alice: 1 unacknowledged · 1 unread · 1 urgent',
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('joins completed task results into a copyable summary', () => {
		const status = test_status(1);
		status.tasks[0]!.assignee = 'alice';
		status.tasks[0]!.result = 'Done cleanly.';

		expect(format_completed_task_results(status)).toContain(
			'#1 @alice Task 1\nDone cleanly.',
		);
		expect(format_team_dashboard(status)).toContain(
			'Completed work (1)',
		);
	});
});

describe('team UI mode', () => {
	it('defaults to compact footer-only UI', () => {
		delete process.env.MY_PI_TEAM_UI;

		expect(get_team_ui_mode()).toBe('compact');
	});

	it('supports hiding and full widget aliases', () => {
		process.env.MY_PI_TEAM_UI = 'off';
		expect(get_team_ui_mode()).toBe('off');

		process.env.MY_PI_TEAM_UI = 'widget';
		expect(get_team_ui_mode()).toBe('full');
	});

	it('supports plain, badge, and color styling', () => {
		delete process.env.MY_PI_TEAM_UI_STYLE;
		expect(get_team_ui_style()).toBe('plain');

		process.env.MY_PI_TEAM_UI_STYLE = 'badges';
		expect(get_team_ui_style()).toBe('badge');

		process.env.MY_PI_TEAM_UI_STYLE = 'colour';
		expect(get_team_ui_style()).toBe('color');
	});

	it('hides the below-editor widget for empty teams', () => {
		expect(should_show_team_widget(test_status(0), 'full')).toBe(
			false,
		);
		expect(should_show_team_widget(test_status(0), 'auto')).toBe(
			false,
		);
	});

	it('shows the below-editor widget for useful team detail', () => {
		expect(should_show_team_widget(test_status(1), 'full')).toBe(
			true,
		);
		expect(
			should_show_team_widget(test_status(0, { pending: 1 }), 'auto'),
		).toBe(true);
		const status = test_status(0);
		status.members.push({
			name: 'alice',
			role: 'teammate',
			status: 'running',
			last_seen_at: '2026-04-30T00:00:00.000Z',
			created_at: '2026-04-30T00:00:00.000Z',
			updated_at: '2026-04-30T00:00:00.000Z',
		});
		expect(should_show_team_widget(status, 'full')).toBe(true);
	});
});
