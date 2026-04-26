// Confirm destructive actions — prompt before clear, switch, or fork

import type {
	ExtensionAPI,
	SessionBeforeSwitchEvent,
	SessionMessageEntry,
} from '@mariozechner/pi-coding-agent';

export default async function confirm_destructive(pi: ExtensionAPI) {
	pi.on(
		'session_before_switch',
		async (event: SessionBeforeSwitchEvent, ctx) => {
			if (!ctx.hasUI) return;

			if (event.reason === 'new') {
				const confirmed = await ctx.ui.confirm(
					'Clear session?',
					'This will delete all messages in the current session.',
				);

				if (!confirmed) {
					ctx.ui.notify('Clear cancelled', 'info');
					return { cancel: true };
				}
				return;
			}

			const entries = ctx.sessionManager.getEntries();
			const has_unsaved_work = entries.some(
				(e): e is SessionMessageEntry =>
					e.type === 'message' && e.message.role === 'user',
			);

			if (has_unsaved_work) {
				const confirmed = await ctx.ui.confirm(
					'Switch session?',
					'You have messages in the current session. Switch anyway?',
				);

				if (!confirmed) {
					ctx.ui.notify('Switch cancelled', 'info');
					return { cancel: true };
				}
			}
		},
	);

	pi.on('session_before_fork', async (event, ctx) => {
		if (!ctx.hasUI) return;

		const choice = await ctx.ui.select(
			`Fork from entry ${event.entryId.slice(0, 8)}?`,
			['Yes, create fork', 'No, stay in current session'],
		);

		if (choice !== 'Yes, create fork') {
			ctx.ui.notify('Fork cancelled', 'info');
			return { cancel: true };
		}
	});
}
