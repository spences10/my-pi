import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type {
	CoordinationSessionRuntime,
	RuntimeLifecycleState,
} from '../db/index.js';
import { TeamDatabase } from '../db/index.js';
import {
	TEAM_RUNTIME_PROTOCOL_VERSION,
	type RuntimeRequest,
	type RuntimeResponse,
} from './protocol.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class RuntimeClientError extends Error {
	constructor(
		message: string,
		readonly state?: RuntimeLifecycleState,
	) {
		super(message);
		this.name = 'RuntimeClientError';
	}
}

async function send_request(
	endpoint: string,
	request: RuntimeRequest,
	timeout_ms = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<RuntimeResponse> {
	return await new Promise((resolve, reject) => {
		const socket = createConnection(endpoint);
		let settled = false;
		let body = '';
		const finish = (error?: Error, response?: RuntimeResponse) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else resolve(response!);
		};
		const timer = setTimeout(
			() => finish(new RuntimeClientError('Runtime request timed out')),
			timeout_ms,
		);
		socket.setEncoding('utf8');
		socket.once('connect', () => {
			socket.write(`${JSON.stringify(request)}\n`);
		});
		socket.on('data', (chunk: string) => {
			body += chunk;
			if (body.length > MAX_RESPONSE_BYTES) {
				finish(new RuntimeClientError('Runtime response was too large'));
				return;
			}
			const newline = body.indexOf('\n');
			if (newline === -1) return;
			try {
				finish(undefined, JSON.parse(body.slice(0, newline)) as RuntimeResponse);
			} catch (error) {
				finish(
					new RuntimeClientError(
						`Invalid runtime response: ${(error as Error).message}`,
					),
				);
			}
		});
		socket.once('error', (error) => finish(error));
	});
}

type RuntimeCallRequest =
	| { method: 'status' | 'abort' | 'shutdown' }
	| { method: 'prompt' | 'steer' | 'follow_up'; message: string };

async function call_runtime(
	runtime: CoordinationSessionRuntime,
	request: RuntimeCallRequest,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	if (!runtime.endpoint)
		throw new RuntimeClientError('Runtime has no control endpoint', runtime.state);
	const response = await send_request(
		runtime.endpoint,
		{
			...request,
			id: randomUUID(),
			version: TEAM_RUNTIME_PROTOCOL_VERSION,
		} as RuntimeRequest,
		timeout_ms,
	);
	if (!response.ok)
		throw new RuntimeClientError(response.error, response.state);
	if (
		response.runtime.runtime_id !== runtime.runtime_id ||
		response.runtime.generation !== runtime.generation
	)
		throw new RuntimeClientError('Runtime ownership changed during request');
	return response.runtime;
}

export async function get_runtime_status(
	runtime: CoordinationSessionRuntime,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'status' }, timeout_ms);
}

export async function prompt_runtime(
	runtime: CoordinationSessionRuntime,
	message: string,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'prompt', message }, timeout_ms);
}

export async function steer_runtime(
	runtime: CoordinationSessionRuntime,
	message: string,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'steer', message }, timeout_ms);
}

export async function follow_up_runtime(
	runtime: CoordinationSessionRuntime,
	message: string,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'follow_up', message }, timeout_ms);
}

export async function abort_runtime(
	runtime: CoordinationSessionRuntime,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'abort' }, timeout_ms);
}

export async function shutdown_runtime(
	runtime: CoordinationSessionRuntime,
	timeout_ms?: number,
): Promise<CoordinationSessionRuntime> {
	return await call_runtime(runtime, { method: 'shutdown' }, timeout_ms);
}

export async function wait_for_runtime_ready(options: {
	db_path: string;
	session_id: string;
	runtime_id: string;
	generation: number;
	timeout_ms?: number;
	poll_ms?: number;
}): Promise<CoordinationSessionRuntime> {
	const timeout_ms = options.timeout_ms ?? 120_000;
	const deadline = Date.now() + timeout_ms;
	const db = await TeamDatabase.open(options.db_path);
	try {
		while (Date.now() <= deadline) {
			const runtime = db.get_session_runtime(options.session_id);
			if (
				!runtime ||
				runtime.runtime_id !== options.runtime_id ||
				runtime.generation !== options.generation
			)
				throw new RuntimeClientError(
					'Runtime ownership changed before readiness',
					runtime?.state,
				);
			if (runtime.state === 'ready' || runtime.state === 'idle')
				return await get_runtime_status(runtime);
			if (runtime.state === 'failed' || runtime.state === 'offline')
				throw new RuntimeClientError(
					runtime.error ?? `Runtime became ${runtime.state}`,
					runtime.state,
				);
			await new Promise((resolve) =>
				setTimeout(resolve, options.poll_ms ?? 25),
			);
		}
		throw new RuntimeClientError('Timed out waiting for runtime readiness');
	} finally {
		db.close();
	}
}

export async function find_session_runtime(
	db_path: string,
	session_id: string,
): Promise<CoordinationSessionRuntime | undefined> {
	const db = await TeamDatabase.open(db_path);
	try {
		return db.get_session_runtime(session_id);
	} finally {
		db.close();
	}
}
