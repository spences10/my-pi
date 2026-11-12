import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	make_api,
	make_command_context,
} from '../../../../tools/test-sdk.js';
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

function registered_commands() {
	const pi = make_api();
	const register_command = vi.spyOn(pi, 'registerCommand');
	register_context_commands(pi);

	return new Map(
		register_command.mock.calls.map(([name, command]) => [
			name,
			command,
		]),
	);
}

describe('register_context_commands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers context commands and completions', () => {
		const commands = registered_commands();

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
		const commands = registered_commands();

		const notify = vi.fn();

		const ctx = make_command_context({
			hasUI: true,
			ui: { notify },
		});

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
		const commands = registered_commands();

		const notify = vi.fn();

		const ctx = make_command_context({
			hasUI: false,
			ui: { notify },
		});

		const command = commands.get('context')!;

		await command.handler('list nope', ctx);
		await command.handler('purge expired', ctx);
		await command.handler('purge source ctx_1', ctx);
		await command.handler('purge 7', ctx);
		await command.handler('purge nope', ctx);
		await command.handler('unknown', ctx);

		expect(notify).toHaveBeenCalledWith(
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
		expect(notify).toHaveBeenCalledWith(
			'Usage: /context purge [older-than-days] | expired | source <source-id>',
			'warning',
		);
		expect(notify).toHaveBeenCalledWith(
			'Unknown context command: unknown. Use list, stats, settings, or purge.',
			'warning',
		);
	});
});
