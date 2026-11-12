import { make_command_context } from '../../../tools/test-sdk.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vite-plus/test';
import { handle_team_command } from './command-handler.js';
import { TeamDatabase } from './db/index.js';
import { execute_team_tool } from './tool-executor.js';

async function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'team-controls-'));
	const db = await TeamDatabase.open(join(dir, 'bus.db'));

	for (const session_id of ['owner', 'peer'])
		db.register_session({ session_id, cwd: '/repo' });

	const group = db.create_group({
		name: 'task',
		cwd: '/repo',
		created_by_session_id: 'owner',
	});

	let actor = 'owner';
	const notify = vi.fn();

	const ctx = make_command_context({
		cwd: '/repo',
		ui: { notify },
	});

	const deps = {
		coordination_db: db,
		get_session_id: () => actor,
		notify_coordination_messages: vi.fn(async () => {}),
	};

	return {
		db,
		group,
		notify,
		actor: (id: string) => {
			actor = id;
		},
		command: (args: string) =>
			handle_team_command(
				args,
				ctx,
				db,
				deps.notify_coordination_messages,
				deps.get_session_id,
			),
		tool: (args: Parameters<typeof execute_team_tool>[0]) =>
			execute_team_tool(args, ctx, deps),
		close: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe('coordination control commands and tools', () => {
	it('invites and accepts explicitly, pauses via either interface, then leaves without dropping mail', async () => {
		const s = await setup();

		try {
			await s.command(`group invite ${s.group.group_id} peer`);
			expect(
				s.db
					.list_group_members(s.group.group_id)
					.find((member) => member.session_id === 'peer')?.status,
			).toBe('inactive');
			s.actor('peer');
			await s.command(`group join ${s.group.group_id}`);

			const send = () =>
				s.db.send_to_session_target({
					from_session_id: 'owner',
					target: 'peer',
					body: 'result',
				});

			send();
			await s.command('pause owner');
			expect(s.db.list_auto_inbox('peer')).toEqual([]);
			await s.tool({ action: 'session_resume', to: 'owner' });
			expect(s.db.list_auto_inbox('peer')).toEqual([]);
			send();
			expect(s.db.list_auto_inbox('peer')).toHaveLength(1);
			await s.tool({
				action: 'session_pause',
				team_id: s.group.group_id,
			});
			await s.command(`resume --group ${s.group.group_id}`);
			expect(s.db.list_auto_inbox('peer')).toEqual([]);
			await s.command('pause');
			await s.tool({ action: 'session_resume' });
			send();
			await s.command(`leave ${s.group.group_id}`);
			expect(s.db.list_auto_inbox('peer')).toEqual([]);
			expect(s.db.list_inbox('peer')).toHaveLength(4); // Invitation plus three results.
			expect(
				s.db
					.list_inbox('peer')
					.every((mail) => !mail.read_at && !mail.acknowledged_at),
			).toBe(true);
		} finally {
			s.close();
		}
	});

	it('binds controls to the caller and rejects ambiguous targets, missing invitations and nonowner closure', async () => {
		const s = await setup();

		try {
			await expect(
				s.tool({
					action: 'session_pause',
					to: 'peer',
					team_id: s.group.group_id,
				}),
			).rejects.toThrow('not both');
			s.actor('peer');
			await expect(
				s.tool({ action: 'group_join', team_id: s.group.group_id }),
			).rejects.toThrow('invitation');
			await expect(
				s.tool({ action: 'group_close', team_id: s.group.group_id }),
			).rejects.toThrow('owner');
			await s.command('pause missing-session');
			expect(s.notify).toHaveBeenCalledWith(
				'Unknown delivery control target',
				'warning',
			);
			expect(s.db.delivery.controls('peer')).toEqual([]);
			s.actor('owner');
			await s.command(`close ${s.group.group_id}`);
			expect(
				s.db.get_group(s.group.group_id)?.closed_at,
			).toBeTruthy();
		} finally {
			s.close();
		}
	});
});
