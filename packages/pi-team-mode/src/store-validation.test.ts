import { describe, expect, it } from 'vitest';
import {
	validate_member,
	validate_message,
	validate_task,
} from './store-validation.js';
import type { TeamMember, TeamMessage, TeamTask } from './store.js';

const timestamp = '2026-05-02T00:00:00.000Z';

describe('store validation', () => {
	it('accepts valid persisted member, task, and message records', () => {
		expect(() =>
			validate_member({
				name: 'alice',
				role: 'teammate',
				status: 'idle',
				last_seen_at: timestamp,
				created_at: timestamp,
				updated_at: timestamp,
			} satisfies TeamMember),
		).not.toThrow();
		expect(() =>
			validate_task({
				id: '1',
				title: 'Work',
				status: 'pending',
				depends_on: [],
				created_at: timestamp,
				updated_at: timestamp,
			} satisfies TeamTask),
		).not.toThrow();
		expect(() =>
			validate_message({
				id: 'msg-1',
				from: 'lead',
				to: 'alice',
				body: 'hello',
				urgent: false,
				created_at: timestamp,
			} satisfies TeamMessage),
		).not.toThrow();
	});

	it('rejects unsafe persisted records', () => {
		expect(() =>
			validate_member({
				name: 'alice/dev',
				role: 'teammate',
				status: 'idle',
				last_seen_at: timestamp,
				created_at: timestamp,
				updated_at: timestamp,
			} satisfies TeamMember),
		).toThrow(/letters, numbers/);
		expect(() =>
			validate_task({
				id: '../bad',
				title: 'Bad',
				status: 'pending',
				depends_on: [],
				created_at: timestamp,
				updated_at: timestamp,
			} satisfies TeamTask),
		).toThrow(/Invalid task id/);
		expect(() =>
			validate_message({
				id: 'msg-1',
				from: 'lead',
				to: 'alice',
				body: '',
				urgent: false,
				created_at: timestamp,
			} satisfies TeamMessage),
		).toThrow(/body/);
	});
});
