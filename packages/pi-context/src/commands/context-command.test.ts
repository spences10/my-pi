import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	purge_context,
	show_context_list,
	show_context_menu,
} from '../ui/menu.js';
import {
	handle_context_settings,
	show_context_stats,
} from '../ui/settings.js';
import { register_context_commands } from './context-command.js';

vi.mock('../ui/menu.js', () => ({
	purge_context: vi.fn(),
	show_context_list: vi.fn(),
	show_context_menu: vi.fn(),
}));

vi.mock('../ui/settings.js', () => ({
	handle_context_settings: vi.fn(),
	show_context_stats: vi.fn(),
}));

type RegisteredCommand = {
	description: string;
	getArgumentCompletions?: (
		prefix: string,
	) => Array<{ value: string }>;
	handler: (args: string, ctx: unknown) => Promise<void>;
};

function fake_pi() {
	const commands = new Map<string, RegisteredCommand>();
	const pi = {
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
	} as unknown as ExtensionAPI;
	return { pi, commands };
}

describe('register_context_commands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers context commands and completions', () => {
		const { pi, commands } = fake_pi();

		register_context_commands(pi);

		expect([...commands.keys()].sort()).toEqual([
			'context',
			'context-stats',
		]);
		expect(
			commands.get('context')?.getArgumentCompletions?.('s'),
		).toEqual([
			{ value: 'stats', label: 'stats' },
			{ value: 'settings', label: 'settings' },
		]);
	});

	it('routes empty UI context, stats, settings, and list subcommands', async () => {
		const { pi, commands } = fake_pi();
		register_context_commands(pi);
		const ctx = { hasUI: true, ui: { notify: vi.fn() } };
		const command = commands.get('context')!;

		await command.handler('', ctx);
		await command.handler('stats', ctx);
		await command.handler('settings light', ctx);
		await command.handler('list 3', ctx);
		await commands.get('context-stats')!.handler('', ctx);

		expect(show_context_menu).toHaveBeenCalledWith(ctx);
		expect(show_context_stats).toHaveBeenCalledTimes(2);
		expect(handle_context_settings).toHaveBeenCalledWith(ctx, [
			'light',
		]);
		expect(show_context_list).toHaveBeenCalledWith(ctx, 3);
	});

	it('validates list and purge arguments before dispatching', async () => {
		const { pi, commands } = fake_pi();
		register_context_commands(pi);
		const ctx = { hasUI: false, ui: { notify: vi.fn() } };
		const command = commands.get('context')!;

		await command.handler('list nope', ctx);
		await command.handler('purge expired', ctx);
		await command.handler('purge source ctx_1', ctx);
		await command.handler('purge 7', ctx);
		await command.handler('purge nope', ctx);
		await command.handler('unknown', ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Usage: /context list [limit]',
			'warning',
		);
		expect(purge_context).toHaveBeenCalledWith(ctx, {
			expired: true,
		});
		expect(purge_context).toHaveBeenCalledWith(ctx, {
			source_id: 'ctx_1',
		});
		expect(purge_context).toHaveBeenCalledWith(ctx, {
			older_than_days: 7,
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Usage: /context purge [older-than-days] | expired | source <source-id>',
			'warning',
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Unknown context command: unknown. Use list, stats, settings, or purge.',
			'warning',
		);
	});
});
