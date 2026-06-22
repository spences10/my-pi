import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	purge_context,
	show_context_list,
	show_context_menu,
} from '../ui/menu.js';
import {
	handle_context_settings,
	show_context_stats,
} from '../ui/settings.js';

export function register_context_commands(pi: ExtensionAPI): void {
	pi.registerCommand('context', {
		description: 'Inspect and manage the context sidecar',
		getArgumentCompletions: (prefix) =>
			['list', 'stats', 'settings', 'purge']
				.filter((item) => item.startsWith(prefix.trim()))
				.map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const [sub = '', ...rest] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			if (!sub && ctx.hasUI) {
				await show_context_menu(ctx);
				return;
			}

			switch (sub || 'list') {
				case 'list': {
					const [limit_text] = rest;
					const limit = limit_text ? Number(limit_text) : undefined;
					if (limit !== undefined && !Number.isFinite(limit)) {
						ctx.ui.notify('Usage: /context list [limit]', 'warning');
						return;
					}
					await show_context_list(ctx, limit);
					return;
				}
				case 'stats':
					await show_context_stats(ctx);
					return;
				case 'settings':
					await handle_context_settings(ctx, rest);
					return;
				case 'purge': {
					const [kind, value] = rest;
					if (kind === 'expired') {
						await purge_context(ctx, { expired: true });
						return;
					}
					if (kind === 'source' && value) {
						await purge_context(ctx, { source_id: value });
						return;
					}
					const days = kind ? Number(kind) : undefined;
					if (days !== undefined && !Number.isFinite(days)) {
						ctx.ui.notify(
							'Usage: /context purge [older-than-days] | expired | source <source-id>',
							'warning',
						);
						return;
					}
					await purge_context(ctx, { older_than_days: days });
					return;
				}
				default:
					ctx.ui.notify(
						`Unknown context command: ${sub}. Use list, stats, settings, or purge.`,
						'warning',
					);
			}
		},
	});

	pi.registerCommand('context-stats', {
		description: 'Show context sidecar byte accounting',
		handler: async (_args, ctx) => {
			await show_context_stats(ctx);
		},
	});
}
