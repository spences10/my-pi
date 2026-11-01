import { describe, expect, it, vi } from 'vite-plus/test';
import { create_peer_message_delivery } from './coordination-formatting.js';
import { CoordinationPoller } from './coordination-poller.js';
import type { CoordinationInboxMessage } from './db/index.js';
import {
	bounded_peer_delivery,
	delivery_message_ids,
	MAX_DELIVERY_BYTES,
	MAX_DELIVERY_MESSAGES,
	peer_delivery_details,
} from './delivery.js';

function message(
	id: string,
	extra: Partial<CoordinationInboxMessage> = {},
): CoordinationInboxMessage {
	return {
		message_id: id,
		from_session_id: 'sender',
		to_session_id: 'receiver',
		scope: 'session',
		target: 'receiver',
		body: `Work ${id}`,
		urgent: false,
		requires_ack: false,
		created_at: '2026-01-01T00:00:00.000Z',
		receipt_created_at: '2026-01-01T00:00:00.000Z',
		metadata: {},
		...extra,
	};
}

function setup(messages = [message('m1')]) {
	const delivered = new Set<string>();
	const db = {
		heartbeat_session: vi.fn(),
		list_inbox: vi.fn(() =>
			messages.filter((item) => !delivered.has(item.message_id)),
		),
		mark_messages_delivered: vi.fn(
			(_session: string, ids: string[]) => {
				for (const id of ids) delivered.add(id);
			},
		),
	};
	const poller = new CoordinationPoller({
		db,
		get_session_id: () => 'receiver',
		should_auto_inject_messages: () => true,
	});
	const pi = { sendMessage: vi.fn() };
	return { db, poller, pi };
}

describe('bounded peer delivery', () => {
	it('caps the entire UTF-8 batch and eventually surfaces every action exactly once', () => {
		let pending = Array.from({ length: 100 }, (_, index) =>
			message(`m${index}`, { body: '🧑‍💻'.repeat(200) }),
		);
		const surfaced: string[] = [];
		while (pending.length) {
			const delivery = bounded_peer_delivery('receiver', pending)!;
			expect(Buffer.byteLength(delivery.content)).toBeLessThanOrEqual(
				MAX_DELIVERY_BYTES,
			);
			expect(delivery.details.messages.length).toBeLessThanOrEqual(
				MAX_DELIVERY_MESSAGES,
			);
			const ids = delivery_message_ids(delivery.details);
			surfaced.push(...ids);
			pending = pending.filter(
				(item) => !ids.includes(item.message_id),
			);
		}
		expect(surfaced).toHaveLength(100);
		expect(new Set(surfaced).size).toBe(100);
	});

	it('coalesces only keyed status from the same sender and target, preserving audit ids', () => {
		const delivery = bounded_peer_delivery('receiver', [
			message('old', {
				message_type: 'status',
				status_key: 'build',
				body: 'old update',
			}),
			message('new', {
				message_type: 'status',
				status_key: 'build',
				body: 'new update',
			}),
			message('other-sender', {
				from_session_id: 'other',
				message_type: 'status',
				status_key: 'build',
			}),
			message('other-key', {
				message_type: 'status',
				status_key: 'test',
			}),
			message('other-target', {
				scope: 'group',
				target: 'group',
				message_type: 'status',
				status_key: 'build',
			}),
			message('unkeyed-1', { message_type: 'status' }),
			message('unkeyed-2', { message_type: 'status' }),
		])!;
		expect(delivery.details.messages).toHaveLength(6);
		expect(delivery_message_ids(delivery.details)).toHaveLength(7);
		expect(delivery.content).not.toContain('old update');
		expect(delivery.content).toContain('new update');
		expect(delivery.content).toContain(
			'1 earlier status updates coalesced',
		);
	});

	it('prioritizes urgent actions without coalescing repeated instructions', () => {
		const delivery = bounded_peer_delivery('receiver', [
			...Array.from({ length: 20 }, (_, i) =>
				message(`action-${i}`, { body: 'same instruction' }),
			),
			message('urgent', { urgent: true }),
		])!;
		expect(delivery.details.messages[0]?.message_id).toBe('urgent');
		expect(delivery.details.messages).toHaveLength(
			MAX_DELIVERY_MESSAGES,
		);
	});

	it('does not accept malformed or foreign provenance', () => {
		const delivery = create_peer_message_delivery('receiver', [
			message('m1'),
		]);
		expect(peer_delivery_details(delivery, 'receiver')).toBeDefined();
		expect(peer_delivery_details(delivery, 'other')).toBeUndefined();
		expect(
			peer_delivery_details(
				{
					...delivery,
					details: { ...delivery.details, messages: [null] },
				},
				'receiver',
			),
		).toBeUndefined();
		expect(
			peer_delivery_details(
				{
					...delivery,
					details: {
						...delivery.details,
						direct_user_authority: true,
					},
				},
				'receiver',
			),
		).toBeUndefined();
	});
});

describe('delivery confirmation', () => {
	it('does not call a queued message delivered until persisted message_end confirms it', () => {
		const { db, poller, pi } = setup();
		poller.poll(pi);
		poller.poll(pi);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		expect(db.mark_messages_delivered).not.toHaveBeenCalled();
		poller.confirm_delivery({
			role: 'custom',
			...pi.sendMessage.mock.calls[0]![0],
		});
		poller.poll(pi);
		expect(db.mark_messages_delivered).toHaveBeenCalledWith(
			'receiver',
			['m1'],
		);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it('leaves status in SQLite until an existing run consumes the latest update', () => {
		const { poller, pi, db } = setup([
			message('old', { message_type: 'status', status_key: 'build' }),
			message('new', { message_type: 'status', status_key: 'build' }),
		]);
		poller.poll(pi);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		const delivery = poller.take_delivery(true)!;
		expect(
			delivery.details.messages.map((item) => item.message_id),
		).toEqual(['new']);
		poller.confirm_delivery(delivery);
		expect(db.mark_messages_delivered).toHaveBeenCalledWith(
			'receiver',
			['old', 'new'],
		);
	});

	it('retries a queued delivery with no persistence confirmation after its lease expires', () => {
		vi.useFakeTimers();
		try {
			const { poller, pi } = setup();
			poller.poll(pi);
			vi.advanceTimersByTime(29_999);
			poller.poll(pi);
			expect(pi.sendMessage).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1);
			poller.poll(pi);
			expect(pi.sendMessage).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('releases a failed synchronous enqueue without marking it delivered', () => {
		const { poller, db, pi } = setup();
		pi.sendMessage.mockImplementationOnce(() => {
			throw new Error('queue rejected');
		});
		expect(() => poller.poll(pi)).toThrow('queue rejected');
		expect(db.mark_messages_delivered).not.toHaveBeenCalled();
		poller.poll(pi);
		expect(pi.sendMessage).toHaveBeenCalledTimes(2);
	});

	it('preserves startup reconciliation when a busy receipt write needs retrying', () => {
		const { poller, db, pi } = setup();
		db.mark_messages_delivered.mockImplementationOnce(() => {
			throw Object.assign(new Error('database is locked'), {
				code: 'ERR_SQLITE_ERROR',
				errcode: 5,
			});
		});
		poller.confirm_delivery(
			create_peer_message_delivery('receiver', [message('m1')]),
		);
		poller.start(pi);
		try {
			poller.poll(pi);
			expect(db.mark_messages_delivered).toHaveBeenCalledTimes(2);
			expect(pi.sendMessage).not.toHaveBeenCalled();
		} finally {
			poller.stop();
		}
	});

	it('retries busy confirmation writes without replaying persisted content', () => {
		const { poller, db, pi } = setup();
		poller.poll(pi);
		db.mark_messages_delivered.mockImplementationOnce(() => {
			throw Object.assign(new Error('database is locked'), {
				code: 'ERR_SQLITE_ERROR',
				errcode: 5,
			});
		});
		poller.confirm_delivery(pi.sendMessage.mock.calls[0]![0]);
		poller.poll(pi);
		expect(db.mark_messages_delivered).toHaveBeenCalledTimes(2);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
	});
});
