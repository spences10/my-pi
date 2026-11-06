import type { TeamCommandDeps } from './types.js';

export function show_team_help({ ctx }: TeamCommandDeps): void {
	ctx.ui.notify(
		[
			'Team commands:',
			'/team sessions — list registered Pi sessions',
			'/team pause|resume [<sender> | --group <group>] — control automatic delivery, not worker execution',
			'/team session list — list registered Pi sessions',
			'/team session send <session-id-or-name> <message> — send a peer message',
			'/team session inbox [--all] [--full] — show this session mailbox',
			'/team session read [message-id...] — mark peer messages read',
			'/team session ack [message-id...] — acknowledge peer messages',
			'/team group list — list coordination groups',
			'/team group create <name> — create a coordination group',
			'/team group invite <group> <session> — owner invites a participant',
			'/team group join <group> [alias] — accept an invitation',
			'/team leave <group> — leave a collaboration',
			'/team close <group> — owner closes a collaboration',
			'/team group send <group> <message> — send a group message',
		].join('\n'),
		'warning',
	);
}
