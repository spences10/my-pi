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
			};
			const poller = new CoordinationPoller({
				db: db as any,
				get_session_id: () => 'session-1',
				should_auto_inject_messages: () => true,
			});
			const pi = { sendUserMessage: vi.fn() } as any;

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
});
