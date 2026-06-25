import { describe, expect, it } from 'vitest';
import { validate_team_tool_params } from './team-tool-params.js';

describe('packages/pi-team-mode/src/team-tool-params.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./team-tool-params.js'),
		).resolves.toBeDefined();
	});

	it('rejects invalid thinking levels', () => {
		expect(() =>
			validate_team_tool_params({
				action: 'member_spawn',
				member: 'alice',
				thinking: 'maximum',
			} as any),
		).toThrow(/thinking must be one of/);
	});
});
