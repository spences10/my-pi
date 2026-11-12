import { describe, expect, it } from 'vite-plus/test';
import { make_command_deps } from '../../test/command-fixture.js';

describe('packages/pi-team-mode/src/commands/types.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./types.js')).resolves.toBeDefined();
	});

	it('describes peer command dependencies', async () => {
		const deps = await make_command_deps();

		try {
			expect(deps.get_session_id()).toBe('session-1');
		} finally {
			deps.coordination_db.close();
		}
	});
});
