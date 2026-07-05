import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from './db/index.js';
import { execute_team_tool } from './tool-executor.js';

let root: string;
let db: TeamDatabase;
let notified: string[];

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-tool-'));
	db = await TeamDatabase.open(join(root, 'coordination.db'));
	notified = [];
	db.register_session({ session_id: 'lead', cwd: '/repo' });
	db.register_session({ session_id: 'alice', cwd: '/repo' });
});

afterEach(() => {
	db.close();
	rmSync(root, { recursive: true, force: true });
});

function deps() {
	return {
		coordination_db: db,
		notify_coordination_messages: async (session_ids: string[]) => {
			notified.push(...session_ids);
		},
		get_session_id: () => 'lead',
	};
}

describe('execute_team_tool peer mailbox actions', () => {
	it('sends messages through the coordination bus', async () => {
		const result = await execute_team_tool(
			{ action: 'message_send', to: 'alice', message: 'hello' },
			{ cwd: '/repo' } as any,
			deps(),
		);

		expect(result.content[0].text).toContain('Sent coordination message');
		expect(notified).toEqual(['alice']);
		expect(db.list_inbox('alice')[0]?.body).toBe('hello');
	});

	it('marks selected peer messages read without acknowledging them', async () => {
		const first = db.send_to_session_target({
			from_session_id: 'lead',
			target: 'alice',
			body: 'first',
		});
		const second = db.send_to_session_target({
			from_session_id: 'lead',
			target: 'alice',
			body: 'second',
		});

		await execute_team_tool(
			{
				action: 'message_read',
				to: 'alice',
				message_ids: [first.message_id],
			},
			{ cwd: '/repo' } as any,
			deps(),
		);

		const messages = db.list_inbox('alice', {
			include_read: true,
			include_acknowledged: true,
		});
		expect(
			messages.find(
				(message) => message.message_id === first.message_id,
			),
		).toMatchObject({ read_at: expect.any(String) });
		expect(
			messages.find(
				(message) => message.message_id === first.message_id,
			)?.acknowledged_at,
		).toBeUndefined();
		expect(
			messages.find(
				(message) => message.message_id === second.message_id,
			)?.read_at,
		).toBeUndefined();
	});

	it('retrieves focused peer message chunks', async () => {
		const message = db.send_to_session_target({
			from_session_id: 'lead',
			target: 'alice',
			body: `${'first '.repeat(260)}${'second '.repeat(260)}${'third '.repeat(260)}`,
		});

		const result = await execute_team_tool(
			{
				action: 'message_list',
				to: 'alice',
				message_id: message.message_id,
				chunk_index: 1,
				before: 1,
			},
			{ cwd: '/repo' } as any,
			deps(),
		);

		expect(result.content[0].text).toContain('chunk 1/');
		expect(result.content[0].text).toContain('chunk 2/');
		expect(result.content[0].text).not.toContain('chunk 3/');
	});
});
