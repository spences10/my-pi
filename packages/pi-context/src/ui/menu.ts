import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	show_confirm_modal,
	show_picker_modal,
} from '@spences10/pi-tui-modal';
import {
	format_list_results,
	format_purge_details,
} from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import {
	get_context_store,
	type ContextPurgeDetails,
} from '../store.js';
import {
	show_context_settings,
	show_context_stats,
	show_context_text_modal,
} from './settings.js';

export async function show_context_list(
	ctx: ExtensionCommandContext,
	limit?: number,
): Promise<void> {
	const scope = scope_from_context(ctx);
	const text = format_list_results(
		get_context_store(scope).list({ ...scope, limit }),
		{ audience: 'tui' },
	);
	if (ctx.hasUI) {
		await show_context_text_modal(
			ctx,
			'Context sidecar sources',
			text,
		);
	} else {
		ctx.ui.notify(text, 'info');
	}
}

export async function purge_context(
	ctx: ExtensionCommandContext,
	options: {
		older_than_days?: number;
		source_id?: string;
		expired?: boolean;
	} = {},
): Promise<void> {
	const policy = get_context_store().stats();
	const days = options.older_than_days ?? policy.retention_days ?? 14;
	let description: string;
	if (options.expired)
		description = 'Delete expired context sources now?';
	else
		description = options.source_id
			? `Delete context source ${options.source_id}?`
			: `Delete context sources older than ${days} day(s)?`;
	const confirmed = ctx.hasUI
		? await show_confirm_modal(ctx, {
				title: 'Purge context sidecar?',
				message: description,
				confirm_label: 'Purge',
			})
		: await ctx.ui.confirm('Purge context sidecar?', description);
	if (!confirmed) return;
	const scope = scope_from_context(ctx);
	let details: ContextPurgeDetails;
	if (options.expired)
		details = { deleted: get_context_store(scope).cleanup().deleted };
	else
		details = get_context_store(scope).purge_with_details({
			...scope,
			older_than_days: options.source_id ? undefined : days,
			source_id: options.source_id,
		});
	ctx.ui.notify(format_purge_details(details), 'info');
}

export async function show_context_menu(
	ctx: ExtensionCommandContext,
): Promise<void> {
	while (true) {
		const selected = await show_picker_modal(ctx, {
			title: 'Context sidecar',
			subtitle: 'Local SQLite storage for oversized tool output',
			items: [
				{
					value: 'list',
					label: 'List recent sources',
					description: 'Browse indexed output in this scope',
				},
				{
					value: 'stats',
					label: 'Show stats',
					description: 'Byte accounting and storage reduction',
				},
				{
					value: 'settings',
					label: 'Configure settings',
					description:
						'Configure capture size, retention, and storage cap',
				},
				{
					value: 'purge',
					label: 'Purge old context',
					description: 'Delete sources older than 14 days',
				},
			],
			footer: 'enter opens • esc close',
		});
		if (!selected) return;
		if (selected === 'list') await show_context_list(ctx);
		else if (selected === 'stats') await show_context_stats(ctx);
		else if (selected === 'settings')
			await show_context_settings(ctx, { nested: true });
		else await purge_context(ctx);
	}
}
