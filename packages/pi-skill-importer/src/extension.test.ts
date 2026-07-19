import { describe, expect, it, vi } from 'vitest';

vi.mock('@spences10/pi-tui-modal', () => ({
	show_picker_modal: vi.fn(async () => undefined),
	show_settings_modal: vi.fn(),
	show_text_modal: vi.fn(),
	show_confirm_modal: vi.fn(),
}));

import skill_importer from './extension.js';

describe('/skill-importer compatibility command', () => {
	it('retains the command and warns on the deprecated interactive entry point', async () => {
		let command:
			| {
					description: string;
					handler: (args: string, ctx: unknown) => Promise<void>;
			  }
			| undefined;
		const pi = {
			registerCommand: (_name: string, value: typeof command) => {
				command = value;
			},
		};
		await skill_importer(pi as never);
		expect(command?.description).toContain('Deprecated');
		const notify = vi.fn();
		await command?.handler('', { hasUI: true, ui: { notify } });
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('/skills → Add / import'),
			'warning',
		);
	});
});
