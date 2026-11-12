import { describe, expect, it } from 'vite-plus/test';
import { show_team_help } from './help.js';
import { make_command_context } from '../../../../tools/test-sdk.js';
import { make_command_deps } from '../../test/command-fixture.js';

describe('packages/pi-team-mode/src/commands/help.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./help.js')).resolves.toBeDefined();
	});

	it('renders the command summary as a warning notification', async () => {
		const notifications: Array<[string, string | undefined]> = [];

		const deps = await make_command_deps({
			ctx: make_command_context({
				ui: {
					notify: (message: string, level?: string) =>
						notifications.push([message, level]),
				},
			}),
		});

		try {
			show_team_help(deps);
		} finally {
			deps.coordination_db.close();
		}

		expect(notifications).toHaveLength(1);
		expect(notifications[0][0]).toContain('/team sessions');
		expect(notifications[0][0]).toContain(
			'/team group send <group> <message>',
		);
		expect(notifications[0][1]).toBe('warning');
	});
});
