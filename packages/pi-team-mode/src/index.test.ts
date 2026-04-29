import { afterEach, describe, expect, it } from 'vitest';
import {
	get_team_ui_mode,
	should_inject_team_prompt,
} from './index.js';

const original_team_ui = process.env.MY_PI_TEAM_UI;

afterEach(() => {
	if (original_team_ui === undefined)
		delete process.env.MY_PI_TEAM_UI;
	else process.env.MY_PI_TEAM_UI = original_team_ui;
});

describe('team prompt shim', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_team_prompt({ systemPromptOptions: {} as any }),
		).toBe(true);
	});

	it('injects when the team tool is selected', () => {
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['team'] } as any,
			}),
		).toBe(true);
	});

	it('does not inject when the team tool is not selected', () => {
		expect(
			should_inject_team_prompt({
				systemPromptOptions: { selectedTools: ['bash'] } as any,
			}),
		).toBe(false);
	});
});

describe('team UI mode', () => {
	it('defaults to compact footer-only UI', () => {
		delete process.env.MY_PI_TEAM_UI;

		expect(get_team_ui_mode()).toBe('compact');
	});

	it('supports hiding and full widget aliases', () => {
		process.env.MY_PI_TEAM_UI = 'off';
		expect(get_team_ui_mode()).toBe('off');

		process.env.MY_PI_TEAM_UI = 'widget';
		expect(get_team_ui_mode()).toBe('full');
	});
});
