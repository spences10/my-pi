import { SqliteBusyError } from '@spences10/pi-sqlite-core';
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
	it('returns retry guidance when the coordination database is busy', async () => {
		const busy_db = db as unknown as {
			send_to_session_target: () => never;
		};
		busy_db.send_to_session_target = () => {
			throw new SqliteBusyError(
				'Update team coordination database',
				null,
			);
		};

		const result = await execute_team_tool(
			{ action: 'message_send', to: 'alice', message: 'hello' },
			{ cwd: '/repo' },
			deps(),
		);

		expect(result.content[0].text).toContain(
			'Retry the team action shortly.',
		);
	});

	it('sends messages through the coordination bus', async () => {
		const result = await execute_team_tool(
			{ action: 'message_send', to: 'alice', message: 'hello' },
			{ cwd: '/repo' },
			deps(),
		);

		expect(result.content[0].text).toContain(
			'Sent coordination message',
		);
		expect(notified).toEqual(['alice']);
		expect(db.list_inbox('alice')[0]?.body).toBe('hello');
	});

	it('marks selected messages in the caller inbox read without acknowledging them', async () => {
		const first = db.send_to_session_target({
			from_session_id: 'alice',
			target: 'lead',
			body: 'first',
		});
		const second = db.send_to_session_target({
			from_session_id: 'alice',
			target: 'lead',
			body: 'second',
		});

		await execute_team_tool(
			{
				action: 'message_read',
				message_ids: [first.message_id],
			},
			{ cwd: '/repo' },
			deps(),
		);

		const messages = db.list_inbox('lead', {
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

	it('retrieves focused chunks from the caller inbox', async () => {
		const message = db.send_to_session_target({
			from_session_id: 'alice',
			target: 'lead',
			body: `${'first '.repeat(260)}${'second '.repeat(260)}${'third '.repeat(260)}`,
		});

		const result = await execute_team_tool(
			{
				action: 'message_list',
				message_id: message.message_id,
				chunk_index: 1,
				before: 1,
			},
			{ cwd: '/repo' },
			deps(),
		);

		expect(result.content[0].text).toContain('chunk 1/');
		expect(result.content[0].text).toContain('chunk 2/');
		expect(result.content[0].text).not.toContain('chunk 3/');
	});

	it('rejects sender spoofing while accepting the caller own alias', async () => {
		await expect(
			execute_team_tool(
				{
					action: 'message_send',
					from: 'alice',
					to: 'alice',
					message: 'spoofed',
				},
				{ cwd: '/repo' },
				deps(),
			),
		).rejects.toThrow(/sender spoofing/);

		await expect(
			execute_team_tool(
				{
					action: 'message_send',
					from: 'lead',
					to: 'alice',
					message: 'legitimate',
				},
				{ cwd: '/repo' },
				deps(),
			),
		).resolves.toBeDefined();
	});

	it('rejects cross-inbox receipt fields before database access', async () => {
		const message = db.send_to_session_target({
			from_session_id: 'lead',
			target: 'alice',
			body: 'private',
		});

		await expect(
			execute_team_tool(
				{
					action: 'message_ack',
					to: 'alice',
					message_ids: [message.message_id],
				},
				{ cwd: '/repo' },
				deps(),
			),
		).rejects.toThrow(/to is not allowed/);
		expect(
			db.list_inbox('alice', {
				include_read: true,
				include_acknowledged: true,
			})[0]?.acknowledged_at,
		).toBeUndefined();
	});
});
