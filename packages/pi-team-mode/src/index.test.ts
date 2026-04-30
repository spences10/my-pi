import { afterEach, describe, expect, it } from 'vitest';
import {
	get_team_ui_mode,
	get_team_ui_style,
	should_inject_team_prompt,
	should_show_team_widget,
} from './index.js';
import type { TeamStatus } from './store.js';

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
			createdAt: '2026-04-30T00:00:00.000Z',
			updatedAt: '2026-04-30T00:00:00.000Z',
			nextTaskId: 1,
		},
		members: [],
		tasks: Array.from({ length: task_count }, (_, index) => ({
			id: String(index + 1),
			title: `Task ${index + 1}`,
			status: 'completed',
			dependsOn: [],
			createdAt: '2026-04-30T00:00:00.000Z',
			updatedAt: '2026-04-30T00:00:00.000Z',
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
			lastSeenAt: '2026-04-30T00:00:00.000Z',
			createdAt: '2026-04-30T00:00:00.000Z',
			updatedAt: '2026-04-30T00:00:00.000Z',
		});
		expect(should_show_team_widget(status, 'full')).toBe(true);
	});
});
