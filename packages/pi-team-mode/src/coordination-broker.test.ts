import { describe, expect, it } from 'vitest';
import {
	COORDINATION_BROKER_PORT_ENV,
	CoordinationBrokerClient,
	ensure_coordination_broker,
} from './coordination-broker.js';

describe('coordination broker', () => {
	it('pushes message notifications to subscribed sessions', async () => {
		process.env[COORDINATION_BROKER_PORT_ENV] = '43192';
		await ensure_coordination_broker();
		let notifications = 0;
		const recipient = new CoordinationBrokerClient({
			get_session_id: () => 'session-b',
			on_message: () => {
				notifications += 1;
			},
		});
		const sender = new CoordinationBrokerClient({
			get_session_id: () => 'session-a',
			on_message: () => undefined,
		});
		recipient.start();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await sender.notify_messages(['session-b'], 'message-1');
		const deadline = Date.now() + 1000;
		while (notifications === 0 && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 25));
		recipient.stop();
		expect(notifications).toBe(1);
	});
});
