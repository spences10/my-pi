import type { ContextEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vite-plus/test';
import { summarize_completed_peer_messages } from './context.js';
import { create_peer_message_delivery } from './coordination-formatting.js';
import type { CoordinationInboxMessage } from './db/index.js';

type Messages = ContextEvent['messages'];
function receipt(
	id: string,
	complete = true,
): CoordinationInboxMessage {
	return {
		message_id: id,
		from_session_id: 'sender',
		to_session_id: 'receiver',
		scope: 'session',
		target: 'receiver',
		body: `Result ${id}: ${'review context '.repeat(30)}`,
		urgent: false,
		requires_ack: true,
		metadata: {},
		created_at: '2026-01-01',
		receipt_created_at: '2026-01-01',
		acknowledged_at: complete ? '2026-01-02' : undefined,
	};
}
function custom(inbox: CoordinationInboxMessage[]): Messages[number] {
	return {
		role: 'custom',
		...create_peer_message_delivery('receiver', inbox),
		timestamp: 0,
	};
}

describe('completed coordination context projection', () => {
	it('replaces completed deliveries with one smaller summary without mutating history', () => {
		const inbox = Array.from({ length: 10 }, (_, i) =>
			receipt(`m${i}`),
		);
		const messages: Messages = [
			{ role: 'user', content: 'Start review', timestamp: 0 },
			...inbox.map((message) => custom([message])),
			{ role: 'user', content: 'Continue', timestamp: 1 },
		];
		const before = JSON.stringify(messages);
		const projected = summarize_completed_peer_messages(
			messages,
			'receiver',
			inbox,
		);
		expect(projected).toHaveLength(3);
		expect(JSON.stringify(projected).length).toBeLessThan(
			before.length / 2,
		);
		expect(JSON.stringify(messages)).toBe(before);
		expect(projected[1]).toMatchObject({
			role: 'custom',
			details: {
				authority: 'peer-only',
				direct_user_authority: false,
			},
		});
		expect(JSON.stringify(projected[1])).toContain(
			'10 messages acknowledged',
		);
		expect(JSON.stringify(projected[1])).toContain('Result m9');
		expect(JSON.stringify(projected[1])).toContain(
			'not user approval',
		);
	});

	it('leaves partial, unresolved, missing, foreign, and ordinary messages untouched', () => {
		const done = receipt('done');
		const pending = receipt('pending', false);
		const mixed = custom([done, pending]);
		const missing = custom([receipt('missing')]);
		const foreign = {
			...custom([done]),
			details: {
				...create_peer_message_delivery('receiver', [done]).details,
				recipient_session_id: 'other',
			},
		};
		const messages: Messages = [
			mixed,
			missing,
			foreign,
			{ role: 'user', content: 'Approved', timestamp: 0 },
		];
		expect(
			summarize_completed_peer_messages(messages, 'receiver', [
				done,
				pending,
			]),
		).toBe(messages);
	});

	it('does not alter tool result pairing or pending peer messages between completed messages', () => {
		const done = receipt('done');
		const pending = receipt('pending', false);
		const tool: Messages[number] = {
			role: 'toolResult',
			toolCallId: 'call-1',
			toolName: 'team',
			content: [{ type: 'text', text: 'A result' }],
			isError: false,
			timestamp: 0,
		};
		const unresolved = custom([pending]);
		const messages: Messages = [
			custom([done]),
			tool,
			unresolved,
			custom([done]),
		];
		const projected = summarize_completed_peer_messages(
			messages,
			'receiver',
			[done, pending],
		);
		expect(projected).toHaveLength(3);
		expect(projected[0]).toBe(tool);
		expect(projected[1]).toBe(unresolved);
	});
});
