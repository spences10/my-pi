import { describe, expect, it } from 'vitest';
import { get_force_disabled_builtins } from './api.js';

describe('get_force_disabled_builtins', () => {
	const enabled = {
		mcp: true,
		skills: true,
		chain: true,
		filter_output: true,
		handoff: true,
		recall: true,
		prompt_presets: true,
		lsp: true,
		session_name: true,
		confirm_destructive: true,
		hooks_resolution: true,
		working_indicator: true,
	} as const;

	it('keeps UI-only built-ins enabled in interactive mode', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'interactive',
		});

		expect(disabled.has('handoff')).toBe(false);
		expect(disabled.has('session-name')).toBe(false);
		expect(disabled.has('confirm-destructive')).toBe(false);
		expect(disabled.has('working-indicator')).toBe(false);
	});

	it('disables UI-only built-ins in print mode', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'print',
		});

		expect(disabled.has('handoff')).toBe(true);
		expect(disabled.has('session-name')).toBe(true);
		expect(disabled.has('confirm-destructive')).toBe(true);
		expect(disabled.has('working-indicator')).toBe(true);
		expect(disabled.has('mcp')).toBe(false);
		expect(disabled.has('prompt-presets')).toBe(false);
		expect(disabled.has('lsp')).toBe(false);
	});

	it('still respects explicit CLI disables', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'json',
			mcp: false,
			recall: false,
		});

		expect(disabled.has('mcp')).toBe(true);
		expect(disabled.has('recall')).toBe(true);
		expect(disabled.has('handoff')).toBe(true);
	});
});
