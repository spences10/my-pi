import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import { existsSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { pathToFileURL } from 'node:url';
import { TeamDatabase } from '../db/index.js';
import {
	adopt_runtime_ownership,
	assert_runtime_owner,
	heartbeat_runtime_ownership,
	transition_runtime,
} from './ownership.js';
import {
	parse_runtime_request,
	TEAM_RUNTIME_PROTOCOL_VERSION,
	type RuntimeHostConfig,
	type RuntimeRequest,
	type RuntimeResponse,
} from './protocol.js';
import { decode_runtime_host_config } from './supervisor.js';

const MAX_REQUEST_BYTES = 1024 * 1024;

function reply(socket: Socket, response: RuntimeResponse): void {
	socket.end(`${JSON.stringify(response)}\n`);
}

export async function run_runtime_host(config: RuntimeHostConfig): Promise<void> {
	const db = await TeamDatabase.open(config.db_path);
	let stopping = false;
	let heartbeat: NodeJS.Timeout | undefined;
	let unsubscribe: (() => void) | undefined;
	const owner = {
		session_id: config.session_id,
		runtime_id: config.runtime_id,
		generation: config.generation,
	};
	const create_runtime: CreateAgentSessionRuntimeFactory = async (options) => {
		const services = await createAgentSessionServices({ cwd: options.cwd });
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager: options.sessionManager,
				sessionStartEvent: options.sessionStartEvent,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
	const server = createServer();
	const current = () => db.get_session_runtime(config.session_id)!;
	const set_state = (state: Parameters<typeof transition_runtime>[1]['state'], error?: string) =>
		transition_runtime(db, { ...owner, state, error });

	const shutdown = async (failed?: Error) => {
		if (stopping) return;
		stopping = true;
		if (heartbeat) clearInterval(heartbeat);
		server.close();
		unsubscribe?.();
		try {
			if (failed) set_state('failed', failed.stack ?? failed.message);
			else {
				set_state('stopping');
				await runtime?.dispose();
				set_state('offline');
			}
		} catch {}
		if (existsSync(config.endpoint)) rmSync(config.endpoint, { force: true });
		db.close();
	};

	async function handle_request(value: unknown, socket: Socket): Promise<void> {
		let request: RuntimeRequest | undefined;
		try {
			request = parse_runtime_request(value);
			assert_runtime_owner(db, owner);
			if (request.method === 'status') {
				reply(socket, { id: request.id, version: TEAM_RUNTIME_PROTOCOL_VERSION, ok: true, runtime: current() });
				return;
			}
			if (request.method === 'shutdown') {
				reply(socket, { id: request.id, version: TEAM_RUNTIME_PROTOCOL_VERSION, ok: true, runtime: current() });
				void shutdown();
				return;
			}
			if (request.method === 'abort') await runtime!.session.abort();
			else if (request.method === 'steer') await runtime!.session.steer(request.message);
			else if (request.method === 'follow_up') await runtime!.session.followUp(request.message);
			else if (request.method === 'prompt') {
				set_state('running');
				await runtime!.session.prompt(
					request.message,
					runtime!.session.isStreaming
						? { streamingBehavior: 'followUp', source: 'extension' }
						: { source: 'extension' },
				);
				set_state('idle');
			}
			reply(socket, { id: request.id, version: TEAM_RUNTIME_PROTOCOL_VERSION, ok: true, runtime: current() });
		} catch (error) {
			reply(socket, {
				id: request?.id ?? 'invalid',
				version: TEAM_RUNTIME_PROTOCOL_VERSION,
				ok: false,
				error: (error as Error).message,
				state: db.get_session_runtime(config.session_id)?.state,
			});
		}
	}

	try {
		const adopted = adopt_runtime_ownership(db, {
			...owner,
			endpoint: config.endpoint,
			lease_ms: config.lease_ms,
		});
		runtime = await createAgentSessionRuntime(create_runtime, {
			cwd: config.cwd,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.open(config.session_file, undefined, config.cwd),
		});
		await runtime.session.bindExtensions({});
		unsubscribe = runtime.session.subscribe((event) => {
			if (stopping) return;
			if (event.type === 'agent_start') set_state('running');
			else if (event.type === 'agent_settled') set_state('idle');
		});
		if (existsSync(config.endpoint)) rmSync(config.endpoint, { force: true });
		server.on('connection', (socket) => {
			socket.setEncoding('utf8');
			let body = '';
			socket.on('data', (chunk: string) => {
				body += chunk;
				if (body.length > MAX_REQUEST_BYTES) return socket.destroy();
				const newline = body.indexOf('\n');
				if (newline === -1) return;
				try {
					void handle_request(JSON.parse(body.slice(0, newline)) as unknown, socket);
				} catch (error) {
					reply(socket, { id: 'invalid', version: 1, ok: false, error: (error as Error).message });
				}
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(config.endpoint, resolve);
		});
		heartbeat = setInterval(() => {
			try {
				heartbeat_runtime_ownership(db, { ...owner, lease_ms: config.lease_ms });
			} catch (error) {
				void shutdown(error as Error);
			}
		}, config.heartbeat_ms ?? Math.max(250, Math.floor((config.lease_ms ?? 15_000) / 3)));
		heartbeat.unref();
		if (config.initial_prompt?.trim()) {
			set_state('running');
			await runtime.session.prompt(config.initial_prompt, { source: 'extension' });
			set_state('idle');
		} else set_state('ready');
		db.register_session({
			session_id: config.session_id,
			session_file: runtime.session.sessionFile,
			cwd: config.cwd,
			pid: adopted.pid,
			status: 'idle',
			availability: 'available',
		});
	} catch (error) {
		await shutdown(error as Error);
		throw error;
	}
	process.once('SIGTERM', () => void shutdown());
	process.once('SIGINT', () => void shutdown());
	await new Promise<void>((resolve) => server.once('close', resolve));
}

function config_argument(argv: string[]): string {
	const index = argv.indexOf('--config');
	if (index < 0 || !argv[index + 1]) throw new Error('Missing --config');
	return argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run_runtime_host(decode_runtime_host_config(config_argument(process.argv))).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
