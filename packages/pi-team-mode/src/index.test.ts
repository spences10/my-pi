import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	find_shared_mutating_conflict,
	get_team_ui_mode,
	get_team_ui_style,
	handle_team_command,
	require_lead_for_teammate_spawn,
	should_inject_team_prompt,
	should_show_team_widget,
} from './index.js';
import { TeamStore, type TeamStatus } from './store.js';

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
			store.upsert_member(team.id, {
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				pid: child.pid,
			});
			const notifications: string[] = [];

			expect(store.get_status(team.id).members).toEqual(
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
