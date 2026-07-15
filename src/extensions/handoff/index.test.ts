import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import handoff, {
	HANDOFF_GUIDE,
	handoff_command_output,
} from './index.js';

describe('pi-handoff command', () => {
	it('explains Pi built-ins without prompt injection', () => {
		expect(HANDOFF_GUIDE).toContain('/fork');
		expect(HANDOFF_GUIDE).toContain('/tree');
		expect(HANDOFF_GUIDE).toContain('/export');
		expect(HANDOFF_GUIDE).toContain('/import');
		expect(HANDOFF_GUIDE).toContain('/share');
	});

	it('can include a user intent note', () => {
		expect(handoff_command_output(' review this later ')).toContain(
			'Intent noted: review this later',
		);
	});

	it('registers /handoff as a help command only', async () => {
		type CommandDefinition = Parameters<
			ExtensionAPI['registerCommand']
		>[1];
		const commands = new Map<string, CommandDefinition>();
		handoff({
			registerCommand(name: string, definition: CommandDefinition) {
				commands.set(name, definition);
			},
		} as ExtensionAPI);

		const notify = vi.fn();
		const ctx = { ui: { notify } } as unknown as Parameters<
			CommandDefinition['handler']
		>[1];
		await commands.get('handoff')?.handler('', ctx);

		expect(notify).toHaveBeenCalledWith(HANDOFF_GUIDE, 'info');
	});
});
