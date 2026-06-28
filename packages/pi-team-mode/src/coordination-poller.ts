import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { format_peer_message_for_injection } from './coordination-formatting.js';
import type { TeamDatabase } from './db.js';

export class CoordinationPoller {
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly options: {
			db: TeamDatabase;
			get_session_id: () => string | undefined;
			should_auto_inject_messages: () => boolean;
		},
	) {}

	start(pi: ExtensionAPI): void {
		this.stop();
		this.timer = setInterval(() => {
			this.poll(pi);
		}, 1000);
		this.timer.unref();
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}

	poll(pi: ExtensionAPI): void {
		const session_id = this.options.get_session_id();
		if (!session_id) return;
		this.options.db.heartbeat_session(session_id);
		if (!this.options.should_auto_inject_messages()) return;
		const messages = this.options.db.list_inbox(session_id, {
			undelivered_only: true,
			include_read: true,
			include_acknowledged: false,
		});
		if (messages.length === 0) return;
		pi.sendUserMessage(
			format_peer_message_for_injection(session_id, messages),
			{
				deliverAs: messages.some((message) => message.urgent)
					? 'steer'
					: 'followUp',
			},
		);
		this.options.db.mark_messages_delivered(
			session_id,
			messages.map((message) => message.message_id),
		);
	}
}
