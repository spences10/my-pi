import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamStore } from './store.js';
import { execute_team_tool } from './tool-executor.js';

let root: string;
let store: TeamStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-tool-'));
	store = new TeamStore(root);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function deps(
	active_team_id: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		store,
		runners: new Map(),
		own_role: 'lead',
		own_member: 'lead',
		get_active_team_id: () => active_team_id,
		set_active_team_id: () => undefined,
		reset_activity: () => undefined,
		get_team_root: () => root,
		get_extension_path: () => join(root, 'extension.js'),
		teammate_profile: () => undefined,
		...overrides,
	};
}

describe('execute_team_tool wait actions', () => {
	it('does not block the lead session while teammates run', async () => {
		const team = store.create_team({ cwd: '/repo' });
		await store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'running_attached',
		});
		let wait_called = false;
		const runners = new Map([
			[
				'alice',
				{
					is_running: true,
					wait_for_idle: async () => {
						wait_called = true;
						throw new Error('member_wait should not block');
					},
				},
			],
		]);

		const result = await execute_team_tool(
			{
				action: 'member_wait',
				member: 'alice',
			},
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id, { runners }) as any,
		);

		expect(wait_called).toBe(false);
		expect(result.content[0].text).toContain('Not blocking on alice');
		expect(result.details).toMatchObject({
			member: 'alice',
			waiting: false,
		});
	});
});

describe('execute_team_tool shutdown actions', () => {
	it('bulk shuts down done attached teammates', async () => {
		const team = store.create_team({ cwd: '/repo' });
		await store.upsert_member(team.id, {
			name: 'alice',
			role: 'teammate',
			status: 'running_attached',
		});
		await store.create_task(team.id, {
			title: 'done work',
			assignee: 'alice',
		});
		await store.update_task(team.id, '1', { status: 'completed' });
		let shutdown_called = false;
		const runners = new Map([
			[
				'alice',
				{
					is_running: true,
					shutdown: async () => {
						shutdown_called = true;
					},
				},
			],
		]);

		const result = await execute_team_tool(
			{ action: 'team_shutdown' },
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id, { runners }) as any,
		);

		expect(shutdown_called).toBe(true);
		expect(result.content[0].text).toContain('Shutdown 1 teammate');
		expect(store.list_members(team.id)[0]?.status).toBe('offline');
	});
});

describe('execute_team_tool mailbox actions', () => {
	it('marks selected messages read without acknowledging them', async () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'first',
		});
		const second = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'second',
		});

		await execute_team_tool(
			{
				action: 'message_read',
				member: 'alice',
				message_ids: [first.id],
			},
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id) as any,
		);

		const messages = store.list_messages(team.id, 'alice');
		expect(
			messages.find((message) => message.id === first.id),
		).toMatchObject({
			read_at: expect.any(String),
		});
		expect(
			messages.find((message) => message.id === first.id)
				?.acknowledged_at,
		).toBeUndefined();
		expect(
			messages.find((message) => message.id === second.id)?.read_at,
		).toBeUndefined();
	});

	it('waits for a matching reply message', async () => {
		const team = store.create_team({ cwd: '/repo' });
		const original = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'question',
		});
		const reply = await store.send_message(team.id, {
			from: 'alice',
			to: 'lead',
			body: 'answer',
			reply_to: original.id,
		});

		const result = await execute_team_tool(
			{
				action: 'message_wait',
				member: 'lead',
				from: 'alice',
				reply_to: original.id,
				timeout_ms: 1,
			},
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id) as any,
		);

		expect(result.content[0].text).toContain(reply.id);
		expect(result.details).toMatchObject({
			message: { id: reply.id, reply_to: original.id },
		});
	});

	it('retrieves focused legacy mailbox message chunks', async () => {
		const team = store.create_team({ cwd: '/repo' });
		const message = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: `${'first '.repeat(260)}${'second '.repeat(260)}${'third '.repeat(260)}`,
		});

		const result = await execute_team_tool(
			{
				action: 'message_list',
				member: 'alice',
				message_id: message.id,
				chunk_index: 1,
				before: 1,
			},
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id) as any,
		);

		expect(result.content[0].text).toContain('chunk 1/');
		expect(result.content[0].text).toContain('chunk 2/');
		expect(result.content[0].text).not.toContain('chunk 3/');
	});

	it('acknowledges selected messages without touching the rest', async () => {
		const team = store.create_team({ cwd: '/repo' });
		const first = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'first',
		});
		const second = await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'second',
		});

		await execute_team_tool(
			{
				action: 'message_ack',
				member: 'alice',
				message_ids: [second.id],
			},
			{
				cwd: '/repo',
				ui: {
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
			deps(team.id) as any,
		);

		const messages = store.list_messages(team.id, 'alice');
		expect(
			messages.find((message) => message.id === first.id)
				?.acknowledged_at,
		).toBeUndefined();
		expect(
			messages.find((message) => message.id === second.id),
		).toMatchObject({
			acknowledged_at: expect.any(String),
		});
	});
});
