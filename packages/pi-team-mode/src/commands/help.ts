import type { TeamCommandDeps } from './types.js';

export function show_team_help({ ctx }: TeamCommandDeps): void {
	ctx.ui.notify(
		[
			'Team commands:',
			'/team sessions — list registered Pi sessions',
			'/team session list — list registered Pi sessions',
			'/team session send <session-id-or-name> <message> — send a peer message',
			'/team session inbox [--all] [--full] — show this session mailbox',
			'/team session read [message-id...] — mark peer messages read',
			'/team session ack [message-id...] — acknowledge peer messages',
			'/team group list — list coordination groups',
			'/team group create <name> — create a coordination group',
			'/team group join <group> [alias] — join a coordination group',
			'/team group send <group> <message> — send a group message',
			'/team member spawn <name> [instructions] — create a visible resumable teammate session',
		].join('\n'),
		'warning',
	);
}
