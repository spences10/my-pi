import { describe, expect, it } from 'vitest';
import {
	format_injected_messages,
	format_messages,
	format_rpc_message,
	format_status,
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

	it('warns when teammates remain alive after all work is done', () => {
		const team_status = status();
		team_status.members = [
			{
				name: 'alice',
				role: 'teammate',
				status: 'running_orphaned',
				pid: 123,
				created_at: '2026-04-30T00:00:00.000Z',
				updated_at: '2026-04-30T00:00:00.000Z',
				last_seen_at: '2026-04-30T00:00:00.000Z',
			},
		];
		team_status.tasks[0]!.status = 'completed';
		team_status.counts = {
			pending: 0,
			in_progress: 0,
			blocked: 0,
			completed: 1,
			cancelled: 0,
		};

		expect(format_status(team_status)).toContain(
			'Use /team shutdown --done to free resources',
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

	it('truncates long mailbox messages by default and supports full formatting', () => {
		const long_body = `review ${'private context '.repeat(40)}final detail`;
		const messages: TeamMessage[] = [
			{
				id: 'msg-1',
				from: 'lead',
				to: 'alice',
				body: long_body,
				urgent: false,
				created_at: '2026-04-30T00:00:00.000Z',
			},
		];

		expect(format_messages(messages)).toContain('[truncated]');
		expect(format_messages(messages)).not.toContain('final detail');
		expect(format_messages(messages, { full: true })).toContain(
			'final detail',
		);

		const injected = format_injected_messages('alice', messages);
		expect(injected).toContain('[truncated]');
		expect(injected).toContain('message_list with mode=full');
		expect(injected).not.toContain('final detail');

		const rpc = format_rpc_message(messages[0]!);
		expect(rpc).toContain('[truncated]');
		expect(rpc).toContain('message_list with mode=full');
		expect(rpc).not.toContain('final detail');
	});
});
