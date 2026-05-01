import { describe, expect, it } from 'vitest';
import {
	format_injected_messages,
	format_messages,
	format_status_counts,
	format_task_detail,
} from './formatting.js';
import type { TeamMessage, TeamStatus } from './store.js';

function status(): TeamStatus {
	return {
		team: {
			version: 1,
			id: 'team-1',
			name: 'alpha',
			cwd: '/repo',
			created_at: '2026-04-30T00:00:00.000Z',
			updated_at: '2026-04-30T00:00:00.000Z',
			next_task_id: 1,
		},
		members: [],
		tasks: [
			{
				id: '1',
				title: 'Ship thing',
				status: 'blocked',
				assignee: 'alice',
				depends_on: ['0'],
				result: 'Needs input',
				created_at: '2026-04-30T00:00:00.000Z',
				updated_at: '2026-04-30T00:00:00.000Z',
			},
		],
		counts: {
			pending: 0,
			in_progress: 0,
			blocked: 1,
			completed: 0,
			cancelled: 0,
		},
	};
}

describe('team formatting boundaries', () => {
	it('formats status counts and task details without store access', () => {
		const team_status = status();

		expect(format_status_counts(team_status)).toContain(
			'1 needs attention',
		);
		expect(format_task_detail(team_status.tasks[0]!)).toContain(
			'! #1 @alice waits for #0 Ship thing',
		);
	});

	it('formats mailbox messages for display and injection', () => {
		const messages: TeamMessage[] = [
			{
				id: 'msg-1',
				from: 'lead',
				to: 'alice',
				body: 'Please check this',
				urgent: true,
				created_at: '2026-04-30T00:00:00.000Z',
			},
		];

		expect(format_messages(messages)).toContain(
			'msg-1 urgent unread from lead',
		);
		expect(format_injected_messages('alice', messages)).toContain(
			'Team mailbox update for alice',
		);
	});
});
