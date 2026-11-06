import { with_sqlite_transaction } from '@spences10/pi-sqlite-core';
import type { DatabaseSync } from 'node:sqlite';

export type DeliveryScope = 'session' | 'sender' | 'group';

/** Recipient-owned attention policy. This does not grant authority to run tools. */
export class DeliveryPolicy {
	constructor(private readonly db: DatabaseSync) {}

	collaboration(
		sender: string,
		recipient: string,
		group_id?: string,
	): string | undefined {
		const row = this.db
			.prepare(`
   SELECT g.group_id FROM groups g
   JOIN group_members s ON s.group_id = g.group_id AND s.session_id = ? AND s.status = 'active'
   JOIN group_members r ON r.group_id = g.group_id AND r.session_id = ? AND r.status = 'active'
   WHERE g.closed_at IS NULL AND (? IS NULL OR g.group_id = ?)
   ORDER BY g.created_at DESC, g.group_id LIMIT 1
  `)
			.get(sender, recipient, group_id ?? null, group_id ?? null) as
			| { group_id: string }
			| undefined;
		return row?.group_id;
	}

	private paused(
		recipient: string,
		sender: string,
		group: string,
	): boolean {
		return !!this.db
			.prepare(`SELECT 1 FROM delivery_controls WHERE session_id = ? AND paused = 1
   AND (scope = 'session' OR (scope = 'sender' AND target = ?) OR (scope = 'group' AND target = ?)) LIMIT 1
  `)
			.get(recipient, sender, group);
	}

	enroll_receipt(
		message_id: string,
		sender: string,
		recipient: string,
		group_id?: string,
	): void {
		const group = this.collaboration(sender, recipient, group_id);
		this.db
			.prepare(`UPDATE message_receipts SET collaboration_id = ?, auto_delivery = ?
   WHERE message_id = ? AND to_session_id = ?`)
			.run(
				group ?? null,
				group && !this.paused(recipient, sender, group) ? 1 : 0,
				message_id,
				recipient,
			);
	}

	can_deliver(message_id: string, recipient: string): boolean {
		const row = this.db
			.prepare(`SELECT m.from_session_id, r.collaboration_id FROM message_receipts r
   JOIN messages m USING (message_id) WHERE r.message_id = ? AND r.to_session_id = ? AND r.auto_delivery = 1
  `)
			.get(message_id, recipient) as
			| { from_session_id: string; collaboration_id: string | null }
			| undefined;
		return (
			!!row?.collaboration_id &&
			!!this.collaboration(
				row.from_session_id,
				recipient,
				row.collaboration_id,
			) &&
			!this.paused(
				recipient,
				row.from_session_id,
				row.collaboration_id,
			)
		);
	}

	set_paused(
		session_id: string,
		paused: boolean,
		scope: DeliveryScope = 'session',
		target = '',
	): void {
		if (scope !== 'session' && !target)
			throw new Error('A delivery control target is required');
		with_sqlite_transaction(
			this.db,
			() => {
				this.db
					.prepare(`INSERT INTO delivery_controls (session_id, scope, target, paused, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, scope, target) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at
   `)
					.run(
						session_id,
						scope,
						scope === 'session' ? '' : target,
						paused ? 1 : 0,
						new Date().toISOString(),
					);
				if (paused)
					this.db
						.prepare(`UPDATE message_receipts SET auto_delivery = 0 WHERE to_session_id = ?
    AND (? = 'session' OR (? = 'group' AND collaboration_id = ?) OR
     (? = 'sender' AND message_id IN (SELECT message_id FROM messages WHERE from_session_id = ?)))
   `)
						.run(session_id, scope, scope, target, scope, target);
			},
			{
				immediate: true,
				operation: 'Update coordination delivery policy',
			},
		);
	}

	controls(session_id: string) {
		return this.db
			.prepare(
				'SELECT scope, target, paused FROM delivery_controls WHERE session_id = ?',
			)
			.all(session_id);
	}

	leave_group(group_id: string, session_id: string): void {
		with_sqlite_transaction(
			this.db,
			() => {
				this.db
					.prepare(
						"UPDATE group_members SET status = 'inactive', updated_at = ? WHERE group_id = ? AND session_id = ?",
					)
					.run(new Date().toISOString(), group_id, session_id);
				this.db
					.prepare(`UPDATE message_receipts SET auto_delivery = 0 WHERE collaboration_id = ?
    AND (to_session_id = ? OR message_id IN (SELECT message_id FROM messages WHERE from_session_id = ?))
   `)
					.run(group_id, session_id, session_id);
			},
			{ immediate: true, operation: 'Leave coordination group' },
		);
	}

	close_group(group_id: string, owner_session_id: string): void {
		with_sqlite_transaction(
			this.db,
			() => {
				const group = this.db
					.prepare(
						'SELECT created_by_session_id FROM groups WHERE group_id = ?',
					)
					.get(group_id) as
					| { created_by_session_id: string | null }
					| undefined;
				if (
					!group ||
					group.created_by_session_id !== owner_session_id
				)
					throw new Error(
						'Only the group owner can close this collaboration',
					);
				this.db
					.prepare(
						'UPDATE groups SET closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE group_id = ?',
					)
					.run(
						new Date().toISOString(),
						new Date().toISOString(),
						group_id,
					);
				this.db
					.prepare(
						'UPDATE message_receipts SET auto_delivery = 0 WHERE collaboration_id = ?',
					)
					.run(group_id);
			},
			{ immediate: true, operation: 'Close coordination group' },
		);
	}
}
