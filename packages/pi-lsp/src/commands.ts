import {
	type ExtensionAPI,
	type ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import {
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { format_lsp_view, format_status_lines } from './format.js';
import { LspServerManager } from './server-manager.js';
import { list_supported_languages } from './servers.js';

export function register_lsp_command(
	pi: ExtensionAPI,
	manager: LspServerManager,
): void {
	pi.registerCommand('lsp', {
		description: 'Show or manage language server state',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.trim().split(/\s+/);
			const subcommands = ['status', 'list', 'restart'];
			if (!prefix.trim()) {
				return subcommands.map((value) => ({
					value,
					label: value,
				}));
			}
			if (parts.length <= 1) {
				return subcommands
					.filter((value) => value.startsWith(parts[0]))
					.map((value) => ({ value, label: value }));
			}
			if (parts[0] === 'restart') {
				const candidate = parts[1] ?? '';
				return ['all', ...list_supported_languages()]
					.filter((value) => value.startsWith(candidate))
					.map((value) => ({
						value: `restart ${value}`,
						label: value,
					}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			await handle_lsp_command(args, ctx, manager);
		},
	});
}

export async function handle_lsp_command(
	args: string,
	ctx: ExtensionCommandContext,
	manager: LspServerManager,
): Promise<void> {
	const parts = args.trim() ? args.trim().split(/\s+/, 2) : [];
	if (parts.length === 0 && has_modal_ui(ctx)) {
		while (true) {
			const selected = await show_lsp_home_modal(ctx, manager);
			if (!selected) return;
			if (selected === 'restart') {
				await handle_lsp_restart_modal(ctx, manager);
				continue;
			}
			if (selected === 'restart-all') {
				await restart_all_lsp_servers(ctx, manager);
				continue;
			}
			await show_lsp_text_modal(
				ctx,
				selected === 'running'
					? 'Running LSP servers'
					: selected === 'failed'
						? 'Failed LSP servers'
						: 'LSP status',
				format_lsp_view(
					selected,
					manager.cwd,
					manager.clients_by_server,
					manager.failed_servers,
				),
			);
		}
	}

	const [subcommand = 'status', target] = parts;

	switch (subcommand) {
		case 'status':
		case 'list':
			await present_lsp_text(
				ctx,
				'LSP status',
				format_status_lines(
					manager.cwd,
					manager.clients_by_server,
					manager.failed_servers,
				).join('\n'),
			);
			return;
		case 'restart': {
			if (!target && has_modal_ui(ctx)) {
				await handle_lsp_restart_modal(ctx, manager);
				return;
			}
			if (!target || target === 'all') {
				await manager.clear_language_state();
				ctx.ui.notify('Restarted all language server state.');
				return;
			}
			if (!list_supported_languages().includes(target)) {
				ctx.ui.notify(
					`Unknown language: ${target}. Use one of: ${list_supported_languages().join(', ')}`,
					'warning',
				);
				return;
			}
			await manager.clear_language_state(target);
			ctx.ui.notify(`Restarted ${target} language server state.`);
			return;
		}
		default:
			ctx.ui.notify(
				`Unknown subcommand: ${subcommand}. Use: status, list, restart`,
				'warning',
			);
	}
}

function has_modal_ui(ctx: ExtensionCommandContext): boolean {
	return ctx.hasUI && typeof ctx.ui.custom === 'function';
}

async function present_lsp_text(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	if (has_modal_ui(ctx)) {
		await show_lsp_text_modal(ctx, title, text);
		return;
	}
	ctx.ui.notify(text);
}

async function show_lsp_home_modal(
	ctx: ExtensionCommandContext,
	manager: LspServerManager,
): Promise<string | undefined> {
	const running_count = manager.clients_by_server.size;
	const failed_count = manager.failed_servers.size;
	return await show_picker_modal(ctx, {
		title: 'Language servers',
		subtitle: `${running_count} running • ${failed_count} failed • ${list_supported_languages().length} supported`,
		items: [
			{
				value: 'status',
				label: 'Status',
				description: `All configured language servers for ${manager.cwd}`,
			},
			{
				value: 'running',
				label: 'Running servers',
				description: `${running_count} active workspace server(s)`,
			},
			{
				value: 'failed',
				label: 'Failed servers',
				description: `${failed_count} failed server(s)`,
			},
			{
				value: 'restart',
				label: 'Restart server',
				description: 'Pick a supported language to restart',
			},
			{
				value: 'restart-all',
				label: 'Restart all',
				description: 'Stop every running language server',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}

async function show_lsp_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_text_modal(ctx, {
		title,
		text,
		max_visible_lines: 20,
		overlay_options: { width: '90%', minWidth: 72 },
	});
}

async function handle_lsp_restart_modal(
	ctx: ExtensionCommandContext,
	manager: LspServerManager,
): Promise<void> {
	const selected = await show_picker_modal(ctx, {
		title: 'Restart LSP server',
		subtitle: 'Clear cached language server state',
		items: [
			{
				value: 'all',
				label: 'All servers',
				description: 'Stop every running language server',
			},
			...list_supported_languages().map((language) => ({
				value: language,
				label: language,
				description: `Restart ${language} language server state`,
			})),
		],
		footer: 'enter restarts • esc back',
	});
	if (!selected) return;
	if (selected === 'all') {
		await restart_all_lsp_servers(ctx, manager);
		return;
	}
	await manager.clear_language_state(selected);
	ctx.ui.notify(`Restarted ${selected} language server state.`);
}

async function restart_all_lsp_servers(
	ctx: ExtensionCommandContext,
	manager: LspServerManager,
): Promise<void> {
	await manager.clear_language_state();
	ctx.ui.notify('Restarted all language server state.');
}
