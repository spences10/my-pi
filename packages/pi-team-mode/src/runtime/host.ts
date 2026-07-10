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
import { consume_runtime_host_config } from './supervisor.js';

const MAX_REQUEST_BYTES = 1024 * 1024;

export function persistent_coordination_prompt(
	config: Pick<
		RuntimeHostConfig,
		'from_session_id' | 'report_to_session_ids'
	>,
): string | undefined {
	const report_targets = [
		config.from_session_id,
		...(config.report_to_session_ids ?? []),
	]
		.filter((session_id): session_id is string => Boolean(session_id))
		.filter(
			(session_id, index, session_ids) =>
				session_ids.indexOf(session_id) === index,
		);
	if (report_targets.length === 0) return undefined;
	return [
		`This persistent Team Mode runtime reports to session${report_targets.length === 1 ? '' : 's'}: ${report_targets.join(', ')}.`,
		`When you have a final result, send a compact report with team session_send to: ${report_targets.join(', ')}. Do not finish without reporting the result, blocker, or artifact id.`,
		`When spawning nested teammates, pass reply_to or to=${report_targets.join(',')} so their final result routes directly to the same recipients.`,
		'After receiving a nested teammate result, continue the parent task and relay the final outcome instead of stopping at the subordinate handoff.',
	].join('\n\n');
}

interface PromptableAgentSession {
	prompt(
		message: string,
		options: {
			source: 'extension';
			streamingBehavior?: 'steer' | 'followUp';
			preflightResult: (success: boolean) => void;
		},
	): Promise<void>;
}

export async function accept_agent_prompt(
	session: PromptableAgentSession,
	message: string,
	options: {
		streamingBehavior?: 'steer' | 'followUp';
		on_background_error?: (error: Error) => void;
	} = {},
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let accepted = false;
		const completion = session.prompt(message, {
			source: 'extension',
			streamingBehavior: options.streamingBehavior,
			preflightResult: (success) => {
				accepted = success;
				if (success) resolve();
				else
					reject(
						new Error('Runtime prompt was rejected during preflight'),
					);
			},
		});
		void completion.catch((error: unknown) => {
			const failure =
				error instanceof Error ? error : new Error(String(error));
			if (accepted) options.on_background_error?.(failure);
			else reject(failure);
		});
	});
}

function reply(socket: Socket, response: RuntimeResponse): void {
	socket.end(`${JSON.stringify(response)}\n`);
}

export async function run_runtime_host(
	config: RuntimeHostConfig,
): Promise<void> {
	const db = await TeamDatabase.open(config.db_path);
	let stopping = false;
	let heartbeat: NodeJS.Timeout | undefined;
	let unsubscribe: (() => void) | undefined;
	const owner = {
		session_id: config.session_id,
		runtime_id: config.runtime_id,
		generation: config.generation,
	};
	const create_runtime: CreateAgentSessionRuntimeFactory = async (
		options,
	) => {
		const coordination_prompt =
			persistent_coordination_prompt(config);
		const services = await createAgentSessionServices({
			cwd: options.cwd,
			resourceLoaderOptions: {
				additionalExtensionPaths: [config.extension_path],
				...(coordination_prompt
					? { appendSystemPrompt: [coordination_prompt] }
					: {}),
			},
		});
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
	let runtime:
		| Awaited<ReturnType<typeof createAgentSessionRuntime>>
		| undefined;
	const server = createServer();
	const current = () => db.get_session_runtime(config.session_id)!;
	const set_state = (
		state: Parameters<typeof transition_runtime>[1]['state'],
		error?: string,
	) => transition_runtime(db, { ...owner, state, error });

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
		if (existsSync(config.endpoint))
			rmSync(config.endpoint, { force: true });
		db.close();
	};

	async function handle_request(
		value: unknown,
		socket: Socket,
	): Promise<void> {
		let request: RuntimeRequest | undefined;
		try {
			request = parse_runtime_request(value);
			assert_runtime_owner(db, owner);
			if (request.method === 'status') {
				reply(socket, {
					id: request.id,
					version: TEAM_RUNTIME_PROTOCOL_VERSION,
					ok: true,
					runtime: current(),
				});
				return;
			}
			if (request.method === 'shutdown') {
				reply(socket, {
					id: request.id,
					version: TEAM_RUNTIME_PROTOCOL_VERSION,
					ok: true,
					runtime: current(),
				});
				void shutdown();
				return;
			}
			if (request.method === 'abort') await runtime!.session.abort();
			else if (request.method === 'steer')
				await runtime!.session.steer(request.message);
			else if (request.method === 'follow_up')
				await runtime!.session.followUp(request.message);
			else if (request.method === 'prompt') {
				await accept_agent_prompt(runtime!.session, request.message, {
					streamingBehavior: runtime!.session.isStreaming
						? 'followUp'
						: undefined,
					on_background_error: (error) => {
						if (!stopping)
							set_state('failed', error.stack ?? error.message);
					},
				});
			}
			reply(socket, {
				id: request.id,
				version: TEAM_RUNTIME_PROTOCOL_VERSION,
				ok: true,
				runtime: current(),
			});
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
			sessionManager: SessionManager.open(
				config.session_file,
				undefined,
				config.cwd,
			),
		});
		await runtime.session.bindExtensions({});
		unsubscribe = runtime.session.subscribe((event) => {
			if (stopping) return;
			const state = current().state;
			if (event.type === 'agent_start' && state !== 'running')
				set_state('running');
			else if (
				event.type === 'agent_settled' &&
				!['idle', 'failed', 'stopping', 'offline'].includes(state)
			)
				set_state('idle');
		});
		if (existsSync(config.endpoint))
			rmSync(config.endpoint, { force: true });
		server.on('connection', (socket) => {
			socket.setEncoding('utf8');
			let body = '';
			socket.on('data', (chunk: string) => {
				body += chunk;
				if (body.length > MAX_REQUEST_BYTES) return socket.destroy();
				const newline = body.indexOf('\n');
				if (newline === -1) return;
				try {
					void handle_request(
						JSON.parse(body.slice(0, newline)) as unknown,
						socket,
					);
				} catch (error) {
					reply(socket, {
						id: 'invalid',
						version: 1,
						ok: false,
						error: (error as Error).message,
					});
				}
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(config.endpoint, resolve);
		});
		heartbeat = setInterval(
			() => {
				try {
					heartbeat_runtime_ownership(db, {
						...owner,
						lease_ms: config.lease_ms,
					});
				} catch (error) {
					void shutdown(error as Error);
				}
			},
			config.heartbeat_ms ??
				Math.max(250, Math.floor((config.lease_ms ?? 15_000) / 3)),
		);
		heartbeat.unref();
		db.register_session({
			session_id: config.session_id,
			session_file: runtime.session.sessionFile,
			cwd: config.cwd,
			agent_name: config.member,
			pid: adopted.pid,
			role: config.role ?? 'teammate',
			status: 'idle',
			availability: 'available',
		});
		set_state('ready');
	} catch (error) {
		await shutdown(error as Error);
		throw error;
	}
	process.once('SIGTERM', () => void shutdown());
	process.once('SIGINT', () => void shutdown());
	await new Promise<void>((resolve) => server.once('close', resolve));
}

function config_file_argument(argv: string[]): string {
	const index = argv.indexOf('--config-file');
	if (index < 0 || !argv[index + 1])
		throw new Error('Missing --config-file');
	return argv[index + 1];
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	run_runtime_host(
		consume_runtime_host_config(config_file_argument(process.argv)),
	).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
