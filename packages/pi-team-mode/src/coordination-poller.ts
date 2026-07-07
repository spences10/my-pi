import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { safe_sqlite_tick } from '@spences10/pi-sqlite-core';
import type {
	CoordinationInboxMessage,
	TeamDatabase,
} from './db/index.js';

function format_raw_delivery(
	messages: CoordinationInboxMessage[],
): string {
	return messages.map((message) => message.body).join('\n\n---\n\n');
}

const HEARTBEAT_INTERVAL_MS = 10_000;

export class CoordinationPoller {
	private timer: NodeJS.Timeout | undefined;
	private last_heartbeat_at = 0;

	constructor(
		private readonly options: {
			db: TeamDatabase;
			get_session_id: () => string | undefined;
			should_auto_inject_messages: () => boolean;
			is_agent_active?: () => boolean;
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
		safe_sqlite_tick(() => this.poll_once(pi));
	}

	private poll_once(pi: ExtensionAPI): void {
		const session_id = this.options.get_session_id();
		if (!session_id) return;
		const now = Date.now();
		if (now - this.last_heartbeat_at >= HEARTBEAT_INTERVAL_MS) {
			this.options.db.heartbeat_session(session_id);
			this.last_heartbeat_at = now;
		}
		if (
			!this.options.should_auto_inject_messages() ||
			this.options.is_agent_active?.()
		)
			return;
		const messages = this.options.db.list_inbox(session_id, {
			undelivered_only: true,
			include_read: true,
			include_acknowledged: false,
		});
		if (messages.length === 0) return;
		pi.sendUserMessage(format_raw_delivery(messages), {
			deliverAs: messages.some((message) => message.urgent)
				? 'steer'
				: 'followUp',
		});
		const message_ids = messages.map((message) => message.message_id);
		this.options.db.mark_messages_delivered(session_id, message_ids);
		this.options.db.mark_messages_read(session_id, message_ids);
	}
}
