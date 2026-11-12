import * as v from 'valibot';
import {
	create_peer_message_delivery,
	TEAM_MODE_PEER_MESSAGE_CUSTOM_TYPE,
	type TeamModePeerMessageDelivery,
} from './coordination-formatting.js';
import type { CoordinationInboxMessage } from './db/index.js';

export const MAX_DELIVERY_BYTES = 4096;
export const MAX_DELIVERY_MESSAGES = 8;

const peer_delivery_message_schema = v.object({
	customType: v.literal(TEAM_MODE_PEER_MESSAGE_CUSTOM_TYPE),
	details: v.looseObject({
		schema_version: v.literal(1),
		source: v.literal('team-mode-peer'),
		authority: v.literal('peer-only'),
		direct_user_authority: v.literal(false),
		recipient_session_id: v.string(),
		represented_message_ids: v.optional(v.array(v.string())),
		messages: v.array(v.looseObject({ message_id: v.string() })),
	}),
});

export type PeerDeliveryDetails = v.InferOutput<
	typeof peer_delivery_message_schema
>['details'];

/** The fields of a session message or entry that can carry a peer delivery. */
export interface PeerDeliveryCandidate {
	role?: string;
	customType?: string;
	details?: unknown;
}

export function peer_delivery_details(
	message: PeerDeliveryCandidate,
	session_id: string,
): PeerDeliveryDetails | undefined {
	const parsed = v.safeParse(peer_delivery_message_schema, message);

	if (
		!parsed.success ||
		parsed.output.details.recipient_session_id !== session_id
	)
		return;

	return parsed.output.details;
}

export function delivery_message_ids(
	details: Pick<
		PeerDeliveryDetails,
		'represented_message_ids' | 'messages'
	>,
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
