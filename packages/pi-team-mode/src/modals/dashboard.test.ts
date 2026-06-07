import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { show_modal } from '@spences10/pi-tui-modal';
import { describe, expect, it, vi } from 'vitest';
import type { TeamStatus } from '../store.js';
import {
	present_completed_task_results,
	show_team_dashboard_modal,
} from './dashboard.js';

vi.mock('@spences10/pi-tui-modal', () => ({
	show_modal: vi.fn(),
}));

const modal = vi.mocked(show_modal);

const status = {
	team: { id: 'team-1', name: 'demo' },
	members: [],
	tasks: [
		{
			id: '1',
			title: 'Ship it',
			status: 'completed',
			depends_on: [],
			result: 'done',
			created_at: '2026-05-24T00:00:00.000Z',
			updated_at: '2026-05-24T00:00:00.000Z',
		},
	],
	counts: {
		members: 0,
		tasks: 1,
		pending: 0,
		in_progress: 0,
		blocked: 0,
		completed: 1,
		cancelled: 0,
	},
} as unknown as TeamStatus;

describe('show_team_dashboard_modal', () => {
	it('opens the dashboard modal and renders team content', async () => {
		modal.mockImplementationOnce(async (_ctx, options, create) => {
			expect(options).toMatchObject({ title: 'Team dashboard' });
			const body = create(
				{ done: vi.fn() },
				{
					fg: (_name: string, text: string) => text,
					bold: (text: string) => text,
				},
				{ get_max_body_lines: () => 20 },
				{ requestRender: vi.fn() } as never,
			);
			expect(body.render(80).join('\n')).toContain(
				'Team dashboard: demo',
			);
			body.dispose?.();
			return 'close';
		});

		await expect(
			show_team_dashboard_modal(
				{} as ExtensionCommandContext,
				{
					team_dir: () => '/tmp/team',
					events_path: () => '/missing/events.jsonl',
				} as never,
				status,
			),
		).resolves.toBe('close');
	});
});

describe('present_completed_task_results', () => {
	it('inserts results into the editor when modal UI supports it', () => {
		const set_editor_text = vi.fn();
		const notify = vi.fn();

		present_completed_task_results(
			{
				mode: 'tui',
				hasUI: true,
				ui: { setEditorText: set_editor_text, notify },
			} as unknown as ExtensionCommandContext,
			status,
		);

		expect(set_editor_text).toHaveBeenCalledWith(
			expect.stringContaining('Ship it'),
		);
		expect(notify).toHaveBeenCalledWith(
			'Inserted completed team results into the editor.',
		);
	});
});
