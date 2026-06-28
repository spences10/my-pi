import {
	createServer,
	type Server,
	type ServerResponse,
} from 'node:http';

export const COORDINATION_BROKER_PORT_ENV =
	'MY_PI_COORDINATION_BROKER_PORT';
const DEFAULT_COORDINATION_BROKER_PORT = 43191;

type BrokerEvent = {
	type: 'messages';
	to_session_ids: string[];
	message_id?: string;
};

type BrokerClient = {
	session_id: string;
	response: ServerResponse;
};

let broker_server: Server | undefined;
let broker_started = false;
const clients = new Set<BrokerClient>();

export function get_coordination_broker_port(): number {
	const value = Number(process.env[COORDINATION_BROKER_PORT_ENV]);
	return Number.isInteger(value) && value > 0
		? value
		: DEFAULT_COORDINATION_BROKER_PORT;
}

function write_event(client: BrokerClient, event: BrokerEvent): void {
	client.response.write(`event: ${event.type}\n`);
	client.response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function read_body(
	request: NodeJS.ReadableStream,
): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request)
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString('utf8');
}

function notify_clients(event: BrokerEvent): void {
	for (const client of clients) {
		if (!event.to_session_ids.includes(client.session_id)) continue;
		write_event(client, event);
	}
}

export async function ensure_coordination_broker(): Promise<void> {
	if (broker_started) return;
	broker_started = true;
	const port = get_coordination_broker_port();
	broker_server = createServer(async (request, response) => {
		const url = new URL(
			request.url ?? '/',
			`http://127.0.0.1:${port}`,
		);
		if (request.method === 'GET' && url.pathname === '/events') {
			const session_id = url.searchParams.get('session_id')?.trim();
			if (!session_id) {
				response.writeHead(400).end('session_id required');
				return;
			}
			response.writeHead(200, {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive',
			});
			const client = { session_id, response };
			clients.add(client);
			response.write(': connected\n\n');
			request.on('close', () => clients.delete(client));
			return;
		}
		if (request.method === 'POST' && url.pathname === '/notify') {
			const event = JSON.parse(
				await read_body(request),
			) as BrokerEvent;
			notify_clients(event);
			response.writeHead(204).end();
			return;
		}
		if (request.method === 'GET' && url.pathname === '/health') {
			response.writeHead(200).end('ok');
			return;
		}
		response.writeHead(404).end('not found');
	});
	broker_server.on('error', (error: NodeJS.ErrnoException) => {
		if (error.code === 'EADDRINUSE') return;
		throw error;
	});
	await new Promise<void>((resolve) => {
		broker_server!.listen(port, '127.0.0.1', resolve);
		broker_server!.once('error', () => resolve());
	});
	broker_server.unref();
}

export class CoordinationBrokerClient {
	private controller: AbortController | undefined;
	private stopped = true;
	private readonly port = get_coordination_broker_port();

	constructor(
		private readonly options: {
			get_session_id: () => string | undefined;
			on_message: () => void;
		},
	) {}

	start(): void {
		this.stop();
		this.stopped = false;
		void this.subscribe();
	}

	stop(): void {
		this.stopped = true;
		this.controller?.abort();
		this.controller = undefined;
	}

	async notify_messages(
		to_session_ids: string[],
		message_id?: string,
	): Promise<void> {
		if (to_session_ids.length === 0) return;
		try {
			await fetch(`http://127.0.0.1:${this.port}/notify`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: 'messages',
					to_session_ids,
					message_id,
				} satisfies BrokerEvent),
			});
		} catch {
			// Polling remains the durable fallback when no broker is reachable.
		}
	}

	private async subscribe(): Promise<void> {
		const session_id = this.options.get_session_id();
		if (!session_id || this.stopped) return;
		const controller = new AbortController();
		this.controller = controller;
		try {
			const response = await fetch(
				`http://127.0.0.1:${this.port}/events?session_id=${encodeURIComponent(session_id)}`,
				{ signal: controller.signal },
			);
			const reader = response.body?.getReader();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';
			while (!controller.signal.aborted) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const events = buffer.split('\n\n');
				buffer = events.pop() ?? '';
				for (const event of events) {
					if (event.includes('event: messages'))
						this.options.on_message();
				}
			}
		} catch {
			// Retry below unless explicitly stopped.
		}
		if (!this.stopped && !controller.signal.aborted) {
			setTimeout(() => this.subscribe(), 1000).unref();
		}
	}
}
