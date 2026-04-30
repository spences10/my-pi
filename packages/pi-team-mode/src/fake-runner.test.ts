import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	fake_teammate_run_until_idle,
	fake_teammate_step,
} from './fake-runner.js';
import { TeamStore } from './store.js';

let root: string;
let store: TeamStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-fake-'));
	store = new TeamStore(root);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('fake teammate runner', () => {
	it('claims and completes the next ready task', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.upsert_member(team.id, { name: 'alice' });
		store.create_task(team.id, { title: 'Inspect store' });

		const result = fake_teammate_step(store, team.id, 'alice');

		expect(result.summary).toContain('completed #1');
		expect(store.load_task(team.id, '1')).toMatchObject({
			status: 'completed',
			assignee: 'alice',
		});
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({
			status: 'idle',
		});
	});

	it('walks dependency chains as tasks unblock', () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = store.create_task(team.id, { title: 'A' });
		store.create_task(team.id, {
			title: 'B',
			depends_on: [first.id],
		});

		const results = fake_teammate_run_until_idle(
			store,
			team.id,
			'alice',
		);

		expect(
			results
				.map((result) => result.completed?.title)
				.filter(Boolean),
		).toEqual(['A', 'B']);
		expect(store.get_status(team.id).counts.completed).toBe(2);
	});

	it('reads mailbox messages before working', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.create_task(team.id, { title: 'A' });
		store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'start here',
			urgent: true,
		});

		const result = fake_teammate_step(store, team.id, 'alice');

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toMatchObject({
			urgent: true,
			read_at: expect.any(String),
			acknowledged_at: expect.any(String),
		});
		expect(
			store.list_messages(team.id, 'alice')[0].acknowledged_at,
		).toBeTruthy();
	});

	it('can shut down from a message without claiming new work', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.create_task(team.id, { title: 'Do not start' });
		store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'shutdown please',
		});

		const result = fake_teammate_step(store, team.id, 'alice', {
			shutdownOnMessage: true,
		});

		expect(result.shutdown).toBe(true);
		expect(store.load_task(team.id, '1').status).toBe('pending');
		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({
			status: 'offline',
		});
	});
});
