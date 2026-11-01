import {
	create_peer_message_delivery,
	TEAM_MODE_PEER_MESSAGE_CUSTOM_TYPE,
	type TeamModePeerMessageDelivery,
	type TeamModePeerMessageDetails,
} from './coordination-formatting.js';
import type { CoordinationInboxMessage } from './db/index.js';

export const MAX_DELIVERY_BYTES = 4096;
export const MAX_DELIVERY_MESSAGES = 8;

export function peer_delivery_details(
	message: unknown,
	session_id: string,
): TeamModePeerMessageDetails | undefined {
	if (!message || typeof message !== 'object') return;
	const value = message as {
		customType?: string;
		details?: TeamModePeerMessageDetails;
	};
	const details = value.details;
	if (
		value.customType !== TEAM_MODE_PEER_MESSAGE_CUSTOM_TYPE ||
		details?.schema_version !== 1 ||
		details.source !== 'team-mode-peer' ||
		details.authority !== 'peer-only' ||
		details.direct_user_authority !== false ||
		details.recipient_session_id !== session_id ||
		!Array.isArray(details.messages) ||
		!details.messages.every(
			(item) =>
				item &&
				typeof item === 'object' &&
				typeof item.message_id === 'string',
		) ||
		(details.represented_message_ids !== undefined &&
			(!Array.isArray(details.represented_message_ids) ||
				!details.represented_message_ids.every(
					(id) => typeof id === 'string',
				)))
	)
		return;
	return details;
}

export function delivery_message_ids(
	details: TeamModePeerMessageDetails,
): string[] {
	return [
		...new Set([
			...(details.represented_message_ids ?? []),
			...details.messages.map((message) => message.message_id),
		]),
	];
}

export function bounded_peer_delivery(
	session_id: string,
	messages: CoordinationInboxMessage[],
): TeamModePeerMessageDelivery | undefined {
	const groups: {
		latest: CoordinationInboxMessage;
		ids: string[];
	}[] = [];
	const statuses = new Map<string, (typeof groups)[number]>();
	for (const message of messages) {
		const key =
			message.message_type === 'status' && message.status_key
				? JSON.stringify([
						message.from_session_id,
						message.scope,
						message.target,
						message.status_key,
					])
				: undefined;
		const group = key ? statuses.get(key) : undefined;
		if (group) {
			group.latest = message;
			group.ids.push(message.message_id);
		} else {
			const next = { latest: message, ids: [message.message_id] };
			groups.push(next);
			if (key) statuses.set(key, next);
		}
	}
	groups.sort(
		(a, b) =>
			Number(b.latest.urgent) - Number(a.latest.urgent) ||
			Number(a.latest.message_type === 'status') -
				Number(b.latest.message_type === 'status'),
	);
	let result: TeamModePeerMessageDelivery | undefined;
	const selected: (typeof groups)[number][] = [];
	for (const group of groups) {
		if (selected.length >= MAX_DELIVERY_MESSAGES) break;
		const candidate = [...selected, group];
		const delivery = create_peer_message_delivery(
			session_id,
			candidate.map((item) => item.latest),
		);
		const ids = candidate.flatMap((item) => item.ids);
		delivery.details.represented_message_ids = ids;
		const coalesced = ids.length - candidate.length;
		if (coalesced)
			delivery.content += `\n${coalesced} earlier status updates coalesced; original messages remain in the mailbox.`;
		if (
			Buffer.byteLength(delivery.content, 'utf8') > MAX_DELIVERY_BYTES
		) {
			if (!result)
				throw new Error(
					'Peer delivery identifiers exceed the batch byte budget',
				);
			break;
		}
		selected.push(group);
		result = delivery;
	}
	return result;
}
