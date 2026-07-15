import { describe, expect, it } from 'vitest';
import {
	get_skill_argument_completions,
	SKILL_SUBCOMMANDS,
} from './completions.js';

describe('packages/pi-skills/src/commands/completions.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./completions.js')).resolves.toBeDefined();
	});

	it('completes top-level subcommands', () => {
		const mgr = {};
		expect(
			get_skill_argument_completions(
				'li',
				mgr as Parameters<typeof get_skill_argument_completions>[1],
			),
		).toEqual([{ value: 'list', label: 'list' }]);
	});

	it('exports the known subcommand list', () => {
		expect(SKILL_SUBCOMMANDS).toContain('profile');
		expect(SKILL_SUBCOMMANDS).toContain('defaults');
	});
});
