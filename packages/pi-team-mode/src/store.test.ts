import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamStore } from './store.js';

let root: string;
let store: TeamStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-store-'));
	store = new TeamStore(root);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('TeamStore', () => {
	it('creates a durable team with a lead member', () => {
		const team = store.create_team({ cwd: '/repo', name: 'demo' });

		expect(team.name).toBe('demo');
		expect(store.load_team(team.id)).toMatchObject({
			id: team.id,
			cwd: '/repo',
		});
		expect(store.list_members(team.id)).toMatchObject([
			{ name: 'lead', role: 'lead', status: 'idle' },
		]);
	});

	it('creates, updates, and counts tasks', () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = store.create_task(team.id, { title: 'Research' });
		const second = store.create_task(team.id, {
			title: 'Implement',
			dependsOn: [first.id],
		});

		expect(store.is_task_ready(team.id, first)).toBe(true);
		expect(store.is_task_ready(team.id, second)).toBe(false);

		store.update_task(team.id, first.id, {
			status: 'completed',
			result: 'done',
		});
		expect(
			store.is_task_ready(
				team.id,
				store.load_task(team.id, second.id),
			),
		).toBe(true);

		const status = store.get_status(team.id);
		expect(status.counts.completed).toBe(1);
		expect(status.counts.pending).toBe(1);
	});

	it('claims the next unblocked task', () => {
		const team = store.create_team({ cwd: '/repo' });
		const blocked_by = store.create_task(team.id, { title: 'A' });
		store.create_task(team.id, {
			title: 'B',
			dependsOn: [blocked_by.id],
		});

		const claimed = store.claim_next_task(team.id, 'alice');

		expect(claimed).toMatchObject({
			title: 'A',
			status: 'in_progress',
			assignee: 'alice',
		});
		expect(store.claim_next_task(team.id, 'bob')).toBeUndefined();
	});

	it('persists mailbox messages and marks them read', () => {
		const team = store.create_team({ cwd: '/repo' });
		const message = store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'hello',
			urgent: true,
		});

		expect(store.list_messages(team.id, 'alice')).toMatchObject([
			{ id: message.id, from: 'lead', body: 'hello', urgent: true },
		]);

		const read = store.mark_messages_read(team.id, 'alice');
		expect(read[0].readAt).toBeTruthy();
		expect(
			store.list_messages(team.id, 'alice')[0].readAt,
		).toBeTruthy();
	});

	it('blocks in-progress tasks when a teammate process is stale', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.upsert_member(team.id, {
			name: 'alice',
			status: 'running',
			pid: 999999999,
		});
		const task = store.create_task(team.id, {
			title: 'Review',
			assignee: 'alice',
		});

		store.refresh_member_process_statuses(team.id);

		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({ status: 'offline' });
		expect(store.load_task(team.id, task.id)).toMatchObject({
			status: 'blocked',
			result: 'Blocked because teammate alice went offline.',
		});
	});
});
