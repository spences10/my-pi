import { describe, expect, it } from 'vitest';
import type { TeamCommandDeps } from './types.js';

describe('packages/pi-team-mode/src/commands/types.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./types.js')).resolves.toBeDefined();
	});

	it('describes peer command dependencies', () => {
		const deps = {
			args: '',
			ctx: { ui: { notify: () => undefined } },
			coordination_db: {},
			notify_coordination_messages: async () => undefined,
			get_session_id: () => 'session-1',
			handle_team_command: async () => undefined,
		} as unknown as TeamCommandDeps;

		expect(deps.get_session_id()).toBe('session-1');
	});
});
