import { describe, expect, it } from 'vitest';
import {
	format_inbox,
	format_peer_message_for_injection,
	format_sessions,
} from './coordination-formatting.js';
import type {
	CoordinationInboxMessage,
	CoordinationSession,
	CoordinationSessionRuntime,
} from './db/index.js';

const session: CoordinationSession = {
	session_id: '019f0f71-967e-7aed-853c-94ac29fbe7b6',
	cwd: '/repo',
	role: 'peer',
	status: 'online',
	availability: 'available',
	pool: 'default',
	tags: [],
	metadata: {},
	created_at: '2026-06-28T00:00:00.000Z',
	updated_at: '2026-06-28T00:00:00.000Z',
	last_seen_at: '2026-06-28T00:00:00.000Z',
};

const long_body = `please review ${'sensitive implementation context '.repeat(30)}final detail`;

const inbox_message: CoordinationInboxMessage = {
	message_id: 'msg-1',
	from_session_id: 'lead-session',
	to_session_id: 'worker-session',
	scope: 'session',
	target: 'worker-session',
	body: long_body,
	urgent: false,
	requires_ack: true,
	created_at: '2026-06-28T00:00:00.000Z',
	metadata: {},
	receipt_created_at: '2026-06-28T00:00:00.000Z',
};

describe('coordination formatting', () => {
	it('truncates session ids by default and prints full ids on request', () => {
		expect(format_sessions([session])).toContain('019f0f71-967…');
		expect(format_sessions([session])).not.toContain(
			'019f0f71-967e-7aed-853c-94ac29fbe7b6',
		);

		expect(format_sessions([session], { full_ids: true })).toContain(
			'019f0f71-967e-7aed-853c-94ac29fbe7b6',
		);
	});

	it('formats persistent runtime identity and terminal diagnostics', () => {
		const runtime: CoordinationSessionRuntime = {
			session_id: session.session_id,
			runtime_id: 'runtime-1',
			generation: 3,
			pid: 1234,
			state: 'failed',
			autonomous: true,
			lease_expires_at: '2026-06-28T00:01:00.000Z',
			exit_signal: 'SIGKILL',
			error: 'Runtime host exited unexpectedly',
			diagnostics: ['stderr was redacted'],
			created_at: '2026-06-28T00:00:00.000Z',
			updated_at: '2026-06-28T00:00:01.000Z',
		};
		const runtimes = new Map([[session.session_id, runtime]]);

		expect(format_sessions([session], { runtimes })).toContain(
			'runtime failed g3 · signal SIGKILL',
		);
		const full = format_sessions([session], {
			full_ids: true,
			runtimes,
		});
		expect(full).toContain('runtime runtime-1 generation 3 pid 1234');
		expect(full).toContain('error Runtime host exited unexpectedly');
		expect(full).toContain('diagnostics stderr was redacted');
	});

	it('labels registered standby sessions', () => {
		expect(
			format_sessions([
				{
					...session,
					metadata: {
						availability: 'standby',
						intent: 'subordinate',
					},
				},
			]),
		).toContain('standby:subordinate');
	});

	it('hides long session intent in compact session lists', () => {
		const text = format_sessions([
			{
				...session,
				intent:
					'Inspect this repo only. Return inventory with files/categories.',
			},
		]);

		expect(text).not.toContain('Inspect this repo only');
		expect(
			format_sessions(
				[{ ...session, intent: 'Inspect this repo only.' }],
				{ full_ids: true },
			),
		).toContain('Inspect this repo only.');
	});

	it('truncates long peer messages for auto-injection', () => {
		const text = format_peer_message_for_injection('worker-session', [
			inbox_message,
		]);

		expect(text).toContain('msg-1');
		expect(text).toContain('[truncated]');
		expect(text).toContain('session_inbox with mode=full');
		expect(text).not.toContain('final detail');
	});

	it('formats inbox compactly by default and fully on request', () => {
		expect(format_inbox([inbox_message])).toContain('[truncated]');
		expect(format_inbox([inbox_message])).not.toContain(
			'final detail',
		);

		expect(format_inbox([inbox_message], { full: true })).toContain(
			'final detail',
		);
		expect(
			format_inbox([inbox_message], { full: true }),
		).not.toContain('[truncated]');
	});
});
