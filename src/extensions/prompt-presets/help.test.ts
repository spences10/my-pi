import { describe, expect, it } from 'vite-plus/test';
import { format_prompt_preset_help, is_subcommand } from './help.js';

describe('src/extensions/prompt-presets/help.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./help.js')).resolves.toBeDefined();
	});

	it('identifies known subcommands', () => {
		expect(is_subcommand('show')).toBe(true);
		expect(is_subcommand('enable')).toBe(true);
		expect(is_subcommand('unknown')).toBe(false);
	});

	it('describes common prompt preset commands', () => {
		const help = format_prompt_preset_help();
		expect(help).toContain('/prompt-preset show');
		expect(help).toContain('Alias: /preset');
	});
});
