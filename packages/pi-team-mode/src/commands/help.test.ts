import { describe, expect, it } from 'vitest';
import { show_team_help } from './help.js';
import type { TeamCommandDeps } from './types.js';

describe('packages/pi-team-mode/src/commands/help.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./help.js')).resolves.toBeDefined();
	});

	it('renders the command summary as a warning notification', () => {
		const notifications: Array<[string, string | undefined]> = [];
		show_team_help({
			ctx: {
				ui: {
					notify: (message: string, level?: string) =>
						notifications.push([message, level]),
				},
			},
		} as unknown as TeamCommandDeps);

		expect(notifications).toHaveLength(1);
		expect(notifications[0][0]).toContain('/team sessions');
		expect(notifications[0][0]).toContain(
			'/team group send <group> <message>',
		);
		expect(notifications[0][1]).toBe('warning');
	});
});
