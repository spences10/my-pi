import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { safe_sqlite_tick } from '@spences10/pi-sqlite-core';
import type { TeamDatabase } from './db/index.js';
import {
	bounded_peer_delivery,
	delivery_message_ids,
	peer_delivery_details,
} from './delivery.js';

const HEARTBEAT_INTERVAL_MS = 10_000;
const DELIVERY_LEASE_MS = 30_000;

type PollerDatabase = Pick<
	TeamDatabase,
	'heartbeat_session' | 'list_inbox' | 'mark_messages_delivered'
>;

export class CoordinationPoller {
	private timer: NodeJS.Timeout | undefined;
	private last_heartbeat_at = 0;
	private readonly in_flight = new Map<string, number>();
	private readonly confirmed = new Set<string>();
	private readonly surfaced = new Set<string>();

	constructor(
		private readonly options: {
			db: PollerDatabase;
			get_session_id: () => string | undefined;
			should_auto_inject_messages: () => boolean;
			is_agent_active?: () => boolean;
		},
	) {}

	start(pi: Pick<ExtensionAPI, 'sendMessage'>): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => this.poll(pi), 1000);
		this.timer.unref();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.in_flight.clear();
		this.confirmed.clear();
		this.surfaced.clear();
	}

	confirm_delivery(message: unknown): void {
		const session_id = this.options.get_session_id();
		if (!session_id) return;
		const details = peer_delivery_details(message, session_id);
		if (!details) return;
		for (const id of delivery_message_ids(details))
			if (!this.surfaced.has(id)) this.confirmed.add(id);
		safe_sqlite_tick(() => this.flush_confirmed(session_id));
	}

	private flush_confirmed(session_id: string): void {
		if (!this.confirmed.size) return;
		const ids = [...this.confirmed];
		this.options.db.mark_messages_delivered(session_id, ids);
		for (const id of ids) {
			this.in_flight.delete(id);
			this.confirmed.delete(id);
			this.surfaced.add(id);
		}
	}

	// Called at a real run boundary; status updates never start a run themselves.
	take_delivery(allow_status_only: boolean) {
		const session_id = this.options.get_session_id();
		if (!session_id || !this.options.should_auto_inject_messages())
			return;
		this.flush_confirmed(session_id);
		const now = Date.now();
		for (const [id, queued_at] of this.in_flight)
			if (now - queued_at >= DELIVERY_LEASE_MS)
				this.in_flight.delete(id);
		if (this.in_flight.size) return;
		const messages = this.options.db.list_inbox(session_id, {
			undelivered_only: true,
			include_read: true,
			include_acknowledged: false,
		});
		if (
			!allow_status_only &&
			!messages.some((message) => message.message_type !== 'status')
		)
			return;
		const delivery = bounded_peer_delivery(session_id, messages);
		if (delivery)
			for (const id of delivery_message_ids(delivery.details))
				this.in_flight.set(id, now);
		return delivery;
	}

	poll(pi: Pick<ExtensionAPI, 'sendMessage'>): void {
		safe_sqlite_tick(() => {
			const session_id = this.options.get_session_id();
			if (!session_id) return;
			this.flush_confirmed(session_id);
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
			const delivery = this.take_delivery(false);
			if (!delivery) return;
			try {
				pi.sendMessage(delivery, {
					triggerTurn: true,
					deliverAs: 'followUp',
				});
			} catch (error) {
				for (const id of delivery_message_ids(delivery.details))
					this.in_flight.delete(id);
				throw error;
			}
		});
	}
}
