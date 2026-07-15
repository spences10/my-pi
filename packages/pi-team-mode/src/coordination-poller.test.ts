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
			const pi = { sendUserMessage: vi.fn() };

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
			body: 'pending message',
			urgent: false,
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
		const pi = { sendUserMessage: vi.fn() };

		poller.poll(pi);

		expect(db.list_inbox).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
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
		const pi = { sendUserMessage: vi.fn() };

		expect(() => poller.poll(pi)).not.toThrow();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
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
		const pi = { sendUserMessage: vi.fn() };

		expect(() => poller.poll(pi)).toThrow('boom');
	});

	it('delivers mailbox messages as raw native user turns', () => {
		const message = {
			message_id: 'm1',
			body: 'Run the focused test and report back.',
			urgent: false,
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
		const pi = { sendUserMessage: vi.fn() };

		poller.poll(pi);

		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			'Run the focused test and report back.',
			{ deliverAs: 'followUp' },
		);
		expect(pi.sendUserMessage.mock.calls[0][0]).not.toContain(
			'coordination message',
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
