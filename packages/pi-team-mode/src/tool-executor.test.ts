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

function deps(active_team_id: string) {
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
	};
}

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
