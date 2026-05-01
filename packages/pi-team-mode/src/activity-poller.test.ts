import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamActivityPoller } from './activity-poller.js';
import { TeamStore } from './store.js';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('team activity poller', () => {
	it('injects unread mailbox messages and marks them delivered', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-poller-'));
		roots.push(root);
		const store = new TeamStore(root);
		const team = store.create_team({ cwd: '/repo' });
		await store.send_message(team.id, {
			from: 'lead',
			to: 'alice',
			body: 'Status?',
		});
		const sent: unknown[] = [];
		const poller = new TeamActivityPoller({
			store,
			runners: new Map(),
			own_member: 'alice',
			own_role: 'teammate',
			get_active_team_id: () => team.id,
			clear_active_team_id: () => undefined,
			should_auto_inject_messages: () => true,
		});

		await poller.poll(
			{
				sendMessage: (message: unknown) => sent.push(message),
			} as any,
			{
				hasUI: false,
				ui: {
					notify: () => undefined,
					setStatus: () => undefined,
					setWidget: () => undefined,
				},
			} as any,
		);

		expect(sent).toHaveLength(1);
		expect(JSON.stringify(sent[0])).toContain(
			'Team mailbox update for alice',
		);
		expect(
			store.list_messages(team.id, 'alice')[0]!.delivered_at,
		).toBeTruthy();
	});
});
