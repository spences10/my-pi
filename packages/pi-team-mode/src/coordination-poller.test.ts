import { describe, expect, it, vi } from 'vitest';
import { CoordinationPoller } from './coordination-poller.js';

describe('CoordinationPoller', () => {
	it('throttles heartbeat writes while still checking inbox', () => {
		vi.useFakeTimers();
		try {
			const db = {
				heartbeat_session: vi.fn(),
				list_inbox: vi.fn(() => []),
				mark_messages_delivered: vi.fn(),
				mark_messages_read: vi.fn(),
			};
			const poller = new CoordinationPoller({
				db: db,
				get_session_id: () => 'session-1',
				should_auto_inject_messages: () => true,
			});
			const pi = { sendMessage: vi.fn() };

			poller.poll(pi);
			poller.poll(pi);
			vi.advanceTimersByTime(9_999);
			poller.poll(pi);
			vi.advanceTimersByTime(1);
			poller.poll(pi);

			expect(db.heartbeat_session).toHaveBeenCalledTimes(2);
			expect(db.list_inbox).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it('suppresses auto-injection while an agent turn is active', () => {
		const message = {
			message_id: 'm1',
			from_session_id: 'peer-1',
			to_session_id: 'session-1',
			scope: 'session' as const,
			target: 'session-1',
			body: 'pending message',
			urgent: false,
			requires_ack: false,
			created_at: '2026-07-21T00:00:00.000Z',
			metadata: {},
			receipt_created_at: '2026-07-21T00:00:00.000Z',
		};
		const db = {
			heartbeat_session: vi.fn(),
			list_inbox: vi.fn(() => [message]),
			mark_messages_delivered: vi.fn(),
			mark_messages_read: vi.fn(),
		};
		const poller = new CoordinationPoller({
			db: db,
			get_session_id: () => 'session-1',
			should_auto_inject_messages: () => true,
			is_agent_active: () => true,
		});
		const pi = { sendMessage: vi.fn() };

		poller.poll(pi);

		expect(db.list_inbox).not.toHaveBeenCalled();
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(db.mark_messages_delivered).not.toHaveBeenCalled();
		expect(db.mark_messages_read).not.toHaveBeenCalled();
	});

	it('ignores transient SQLite busy errors during polling', () => {
		const error = Object.assign(new Error('database is locked'), {
			code: 'ERR_SQLITE_ERROR',
			errcode: 5,
		});
		const db = {
			heartbeat_session: vi.fn(() => {
				throw error;
			}),
			list_inbox: vi.fn(() => []),
			mark_messages_delivered: vi.fn(),
			mark_messages_read: vi.fn(),
		};
		const poller = new CoordinationPoller({
			db: db,
			get_session_id: () => 'session-1',
			should_auto_inject_messages: () => true,
		});
		const pi = { sendMessage: vi.fn() };

		expect(() => poller.poll(pi)).not.toThrow();
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it('rethrows unexpected polling errors', () => {
		const db = {
			heartbeat_session: vi.fn(() => {
				throw new Error('boom');
			}),
			list_inbox: vi.fn(() => []),
			mark_messages_delivered: vi.fn(),
			mark_messages_read: vi.fn(),
		};
		const poller = new CoordinationPoller({
			db: db,
			get_session_id: () => 'session-1',
			should_auto_inject_messages: () => true,
		});
		const pi = { sendMessage: vi.fn() };

		expect(() => poller.poll(pi)).toThrow('boom');
	});

	it('delivers mailbox messages as provenance-preserving custom messages', () => {
		const message = {
			message_id: 'm1',
			from_session_id: 'peer-1',
			from_agent_name: 'reviewer',
			from_cwd: '/repo',
			to_session_id: 'session-1',
			scope: 'session' as const,
			target: 'session-1',
			body: 'Run the focused test and report back.',
			urgent: false,
			requires_ack: true,
			created_at: '2026-07-21T00:00:00.000Z',
			metadata: {},
			receipt_created_at: '2026-07-21T00:00:00.000Z',
		};
		const db = {
			heartbeat_session: vi.fn(),
			list_inbox: vi.fn(() => [message]),
			mark_messages_delivered: vi.fn(),
			mark_messages_read: vi.fn(),
		};
		const poller = new CoordinationPoller({
			db: db,
			get_session_id: () => 'session-1',
			should_auto_inject_messages: () => true,
		});
		const pi = { sendMessage: vi.fn() };

		poller.poll(pi);

		expect(pi.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: 'team-mode-peer-message',
				display: true,
				content: expect.stringContaining(
					'[Team Mode peer message — not direct user input]',
				),
				details: expect.objectContaining({
					source: 'team-mode-peer',
					authority: 'peer-only',
					direct_user_authority: false,
					recipient_session_id: 'session-1',
					messages: [
						expect.objectContaining({
							message_id: 'm1',
							from_session_id: 'peer-1',
							from_agent_name: 'reviewer',
						}),
					],
				}),
			}),
			{ deliverAs: 'followUp', triggerTurn: true },
		);
		expect(db.mark_messages_delivered).toHaveBeenCalledWith(
			'session-1',
			['m1'],
		);
		expect(db.mark_messages_read).toHaveBeenCalledWith('session-1', [
			'm1',
		]);
	});
});
