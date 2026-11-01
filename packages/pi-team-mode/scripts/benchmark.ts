import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { summarize_completed_peer_messages } from '../dist/context.js';
import {
	create_peer_message_delivery,
	type TeamModePeerMessageDelivery,
} from '../dist/coordination-formatting.js';
import { CoordinationPoller } from '../dist/coordination-poller.js';
import { TeamDatabase } from '../dist/db/index.js';
import { delivery_message_ids } from '../dist/delivery.js';
import { execute_coordination_action } from '../dist/tools/coordination-actions.js';

type Metrics = Record<string, number>;
const results: Record<string, Metrics> = {};
type SendOptions = Partial<
	Parameters<TeamDatabase['send_message']>[0]
>;
interface Scenario {
	db: TeamDatabase;
	send: (
		extra?: SendOptions,
	) => ReturnType<TeamDatabase['send_message']>;
	poller: CoordinationPoller;
	pi: Pick<ExtensionAPI, 'sendMessage'>;
	context: Parameters<typeof execute_coordination_action>[1];
	finishRun: () => void;
}

async function scenario(
	name: string,
	run: (
		scenario: Scenario,
	) => Promise<Metrics | void> | Metrics | void,
) {
	const dir = mkdtempSync(join(tmpdir(), 'team-benchmark-'));
	const db = await TeamDatabase.open(join(dir, 'coordination.db'));
	try {
		db.register_session({ session_id: 'sender', cwd: '/benchmark' });
		db.register_session({
			session_id: 'receiver',
			cwd: '/benchmark',
		});
		const deliveries: {
			message: TeamModePeerMessageDelivery;
			wakeup: boolean;
		}[] = [];
		let active = false;
		let continuations = 0;
		const poller = new CoordinationPoller({
			db,
			get_session_id: () => 'receiver',
			should_auto_inject_messages: () => true,
			is_agent_active: () => active,
		});
		const record = (
			message: TeamModePeerMessageDelivery,
			wakeup: boolean,
		) => {
			deliveries.push({ message, wakeup });
			poller.confirm_delivery({ role: 'custom', ...message });
		};
		const pi: Scenario['pi'] = {
			sendMessage(message, options) {
				record(
					message as TeamModePeerMessageDelivery,
					!!options?.triggerTurn,
				);
				if (options?.triggerTurn) active = true;
			},
		};
		// Model the upstream settlement boundary: append a batch and continue the
		// existing run, rather than counting every provider request as a new wake-up.
		const finishRun = () => {
			for (let i = 0; i < 200; i++) {
				const delivery = poller.take_delivery(false);
				if (!delivery) {
					active = false;
					return;
				}
				record(delivery, false);
				continuations++;
			}
			throw new Error(
				'Benchmark failed to drain actionable messages',
			);
		};
		const send: Scenario['send'] = (extra = {}) =>
			db.send_message({
				from_session_id: 'sender',
				to_session_ids: ['receiver'],
				scope: 'session',
				target: 'receiver',
				body: 'Status unchanged',
				...extra,
			});
		const context: Scenario['context'] = {
			ctx: { cwd: '/benchmark' },
			coordination_db: db,
			notify_coordination_messages: async () => {},
			require_session_id: () => 'receiver',
		};
		const start = performance.now();
		const extra = await run({
			db,
			send,
			poller,
			pi,
			context,
			finishRun,
		});
		const sizes = deliveries.map(({ message }) =>
			Buffer.byteLength(message.content),
		);
		results[name] = {
			...extra,
			deliveries: deliveries.length,
			wakeups: deliveries.filter(({ wakeup }) => wakeup).length,
			continuations,
			surfaced_messages: deliveries.reduce(
				(sum, { message }) =>
					sum + delivery_message_ids(message.details).length,
				0,
			),
			injected_bytes: sizes.reduce((sum, size) => sum + size, 0),
			max_batch_bytes: Math.max(0, ...sizes),
			elapsed_ms: Number((performance.now() - start).toFixed(3)),
		};
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

await scenario(
	'retry_same_key',
	({ send, poller, pi, finishRun }) => {
		const ids = new Set(
			Array.from(
				{ length: 100 },
				() => send({ idempotency_key: 'retry-1' }).message_id,
			),
		);
		poller.poll(pi);
		finishRun();
		return { stored_messages: ids.size };
	},
);
await scenario(
	'inbox_then_poll',
	async ({ send, context, poller, pi }) => {
		send();
		await execute_coordination_action(
			{ action: 'session_inbox' },
			context,
		);
		poller.poll(pi);
	},
);
await scenario('status_burst', ({ send, poller, pi }) => {
	for (let i = 0; i < 100; i++) {
		send({
			body: `Progress ${i}`,
			message_type: 'status',
			status_key: 'build',
		});
		poller.poll(pi);
	}
	const delivery = poller.take_delivery(true);
	if (delivery) pi.sendMessage(delivery, { triggerTurn: false });
});
await scenario(
	'action_backlog',
	({ send, poller, pi, finishRun }) => {
		for (let i = 0; i < 100; i++)
			send({ body: `${i}: ${'Review result '.repeat(30)}` });
		poller.poll(pi);
		finishRun();
	},
);
await scenario('completed_context', ({ db, send }) => {
	const ids = Array.from(
		{ length: 100 },
		(_, i) =>
			send({ body: `Result ${i}: ${'review context '.repeat(30)}` })
				.message_id,
	);
	db.mark_messages_acknowledged('receiver', ids);
	const inbox = db.list_inbox('receiver', {
		include_read: true,
		include_acknowledged: true,
	});
	const messages = inbox.map((message) => ({
		role: 'custom' as const,
		...create_peer_message_delivery('receiver', [message]),
		timestamp: 0,
	}));
	const projected = summarize_completed_peer_messages(
		messages,
		'receiver',
		inbox,
	);
	const contentBytes = (items: typeof projected) =>
		items.reduce(
			(sum, message) =>
				sum +
				('content' in message
					? Buffer.byteLength(
							typeof message.content === 'string'
								? message.content
								: JSON.stringify(message.content),
						)
					: 0),
			0,
		);
	const before = contentBytes(messages);
	const after = contentBytes(projected);
	return {
		context_bytes_before: before,
		context_bytes_after: after,
		context_reduction_percent: Number(
			(100 * (1 - after / before)).toFixed(1),
		),
	};
});

const outputIndex = process.argv.indexOf('--out');
if (outputIndex >= 0)
	writeFileSync(
		process.argv[outputIndex + 1]!,
		`${JSON.stringify(results, null, 2)}\n`,
	);
const baselineIndex = process.argv.indexOf('--baseline');
if (baselineIndex >= 0) {
	const baseline = JSON.parse(
		readFileSync(process.argv[baselineIndex + 1]!, 'utf8'),
	) as Record<string, Metrics>;
	for (const [name, result] of Object.entries(results)) {
		if (!baseline[name]) continue;
		result.baseline_injected_bytes = baseline[name].injected_bytes!;
		result.byte_reduction_percent = baseline[name].injected_bytes
			? Number(
					(
						100 *
						(1 -
							result.injected_bytes! / baseline[name].injected_bytes!)
					).toFixed(1),
				)
			: 0;
	}
}
console.log(JSON.stringify(results, null, 2));
if (process.argv.includes('--assert')) {
	if (
		results.retry_same_key!.stored_messages !== 1 ||
		results.inbox_then_poll!.deliveries !== 0 ||
		results.status_burst!.wakeups !== 0 ||
		results.status_burst!.deliveries !== 1 ||
		results.status_burst!.surfaced_messages !== 100 ||
		results.action_backlog!.surfaced_messages !== 100 ||
		results.action_backlog!.max_batch_bytes! > 4096 ||
		results.action_backlog!.wakeups !== 1 ||
		results.completed_context!.context_bytes_after! >=
			results.completed_context!.context_bytes_before!
	) {
		throw new Error('Team delivery benchmark invariants failed');
	}
}
