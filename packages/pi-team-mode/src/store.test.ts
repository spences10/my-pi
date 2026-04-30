import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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

	it('lists legacy teams without updated_at metadata', () => {
		const created_at = '2026-04-30T00:00:00.000Z';
		const team_dir = join(root, 'legacy-team');
		mkdirSync(team_dir, { recursive: true });
		writeFileSync(
			join(team_dir, 'config.json'),
			JSON.stringify({
				version: 1,
				id: 'legacy-team',
				name: 'legacy',
				cwd: '/repo',
				created_at,
				next_task_id: 1,
			}),
		);

		expect(store.list_teams()).toMatchObject([
			{ id: 'legacy-team', created_at },
		]);
	});

	it('creates, updates, and counts tasks', () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = store.create_task(team.id, { title: 'Research' });
		const second = store.create_task(team.id, {
			title: 'Implement',
			depends_on: [first.id],
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
			depends_on: [blocked_by.id],
		});

		const claimed = store.claim_next_task(team.id, 'alice');

		expect(claimed).toMatchObject({
			title: 'A',
			status: 'in_progress',
			assignee: 'alice',
		});
		expect(store.claim_next_task(team.id, 'bob')).toBeUndefined();
	});

	it('keeps assigned tasks queued until their assignee claims them', () => {
		const team = store.create_team({ cwd: '/repo' });
		const task = store.create_task(team.id, {
			title: 'Assigned work',
			assignee: 'alice',
		});

		expect(task).toMatchObject({
			assignee: 'alice',
			status: 'pending',
		});
		expect(store.claim_next_task(team.id, 'bob')).toBeUndefined();
		expect(store.claim_next_task(team.id, 'alice')).toMatchObject({
			id: task.id,
			status: 'in_progress',
			assignee: 'alice',
		});
	});

	it('rejects ambiguous member and assignee names', () => {
		const team = store.create_team({ cwd: '/repo' });

		expect(() =>
			store.upsert_member(team.id, { name: 'alice/dev' }),
		).toThrow(/letters, numbers/);
		expect(() =>
			store.create_task(team.id, {
				title: 'Assigned work',
				assignee: 'alice dev',
			}),
		).toThrow(/assignee/);
		expect(() =>
			store.send_message(team.id, {
				from: 'lead',
				to: 'alice/dev',
				body: 'hello',
			}),
		).toThrow(/to/);
	});

	it('validates task dependencies and rejects cycles', () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = store.create_task(team.id, { title: 'A' });
		const second = store.create_task(team.id, {
			title: 'B',
			depends_on: [first.id],
		});

		expect(() =>
			store.create_task(team.id, {
				title: 'Missing dep',
				depends_on: ['999'],
			}),
		).toThrow(/Unknown dependency/);
		expect(() =>
			store.update_task(team.id, first.id, {
				depends_on: [second.id],
			}),
		).toThrow(/cycle/);
	});

	it('recovers stale locks left by dead processes', () => {
		const team = store.create_team({ cwd: '/repo' });
		const lock = join(store.team_dir(team.id), '.lock');
		mkdirSync(lock, { recursive: true });
		writeFileSync(
			join(lock, 'owner.json'),
			JSON.stringify({
				pid: 999999999,
				created_at: new Date().toISOString(),
			}),
		);

		expect(() =>
			store.create_task(team.id, { title: 'After stale lock' }),
		).not.toThrow();
		expect(store.list_tasks(team.id)).toHaveLength(1);
	});

	it('quarantines malformed persisted task files during lists', () => {
		const team = store.create_team({ cwd: '/repo' });
		const good = store.create_task(team.id, { title: 'Good' });
		writeFileSync(
			join(store.tasks_dir(team.id), 'bad-json.json'),
			'{',
		);
		writeFileSync(
			join(store.tasks_dir(team.id), 'bad-status.json'),
			JSON.stringify({
				id: 'bad-status',
				title: 'Bad status',
				status: 'wat',
				depends_on: [],
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			}),
		);
		writeFileSync(
			join(store.tasks_dir(team.id), 'bad-id.json'),
			JSON.stringify({
				id: '../bad',
				title: 'Bad id',
				status: 'pending',
				depends_on: [],
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			}),
		);

		expect(store.list_tasks(team.id)).toMatchObject([
			{ id: good.id },
		]);
		expect(
			readdirSync(store.tasks_dir(team.id)).filter((name) =>
				name.includes('.invalid-'),
			),
		).toHaveLength(3);
	});

	it('quarantines malformed persisted members and messages during lists', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.upsert_member(team.id, { name: 'alice' });
		writeFileSync(
			join(store.members_dir(team.id), 'bad-member.json'),
			JSON.stringify({
				name: 'bad/member',
				role: 'teammate',
				status: 'idle',
				last_seen_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			}),
		);
		store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'hello',
		});
		writeFileSync(
			join(store.mailbox_dir(team.id, 'alice'), 'bad-message.json'),
			JSON.stringify({
				id: '../bad',
				from: 'lead',
				to: 'alice',
				body: 'bad',
				urgent: false,
				created_at: new Date().toISOString(),
			}),
		);

		expect(
			store.list_members(team.id).map((member) => member.name),
		).toEqual(['alice', 'lead']);
		expect(store.list_messages(team.id, 'alice')).toHaveLength(1);
		expect(
			readdirSync(store.members_dir(team.id)).some((name) =>
				name.includes('.invalid-'),
			),
		).toBe(true);
		expect(
			readdirSync(store.mailbox_dir(team.id, 'alice')).some((name) =>
				name.includes('.invalid-'),
			),
		).toBe(true);
	});

	it('tracks mailbox delivery, read, and acknowledgement separately', () => {
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

		const delivered = store.mark_messages_delivered(
			team.id,
			'alice',
			[message.id],
		);
		expect(delivered[0].delivered_at).toBeTruthy();
		expect(delivered[0].read_at).toBeUndefined();
		expect(delivered[0].acknowledged_at).toBeUndefined();

		const read = store.mark_messages_read(team.id, 'alice', [
			message.id,
		]);
		expect(read[0].read_at).toBeTruthy();
		expect(read[0].acknowledged_at).toBeUndefined();

		const acknowledged = store.acknowledge_messages(
			team.id,
			'alice',
			[message.id],
		);
		expect(acknowledged[0].acknowledged_at).toBeTruthy();
	});

	it('can restore delivered but unacknowledged messages to unread', () => {
		const team = store.create_team({ cwd: '/repo' });
		const message = store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'hello',
		});
		store.mark_messages_delivered(team.id, 'alice', [message.id]);

		const restored = store.clear_unacknowledged_deliveries(
			team.id,
			'alice',
		);

		expect(restored[0].delivered_at).toBeUndefined();
		expect(restored[0].read_at).toBeUndefined();
	});

	it('persists teammate workspace metadata', () => {
		const team = store.create_team({ cwd: '/repo' });

		store.upsert_member(team.id, {
			name: 'alice',
			cwd: '/repo/.worktrees/alice',
			workspace_mode: 'worktree',
			worktree_path: '/repo/.worktrees/alice',
			branch: 'team/alice',
			mutating: true,
		});

		expect(
			store
				.list_members(team.id)
				.find((member) => member.name === 'alice'),
		).toMatchObject({
			workspace_mode: 'worktree',
			worktree_path: '/repo/.worktrees/alice',
			branch: 'team/alice',
			mutating: true,
		});
	});

	it('marks live persisted teammate processes as orphaned after restart', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'idle',
			pid: process.pid,
		});

		expect(store.get_status(team.id).members).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'alice',
					status: 'running_orphaned',
				}),
			]),
		);
	});

	it('keeps attached running teammates distinct from orphaned processes', () => {
		const team = store.create_team({ cwd: '/repo' });
		store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'running',
			pid: process.pid,
		});

		expect(
			store.get_status(team.id, new Set(['alice'])).members,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'alice',
					status: 'running_attached',
				}),
			]),
		);
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
			status: 'in_progress',
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
