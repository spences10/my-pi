import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AUTO_INJECT_ENV,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from '../config.js';
import type { CoordinationSessionRuntime } from '../db/index.js';
import { TeamDatabase } from '../db/index.js';
import { wait_for_runtime_ready } from './client.js';
import {
	DEFAULT_RUNTIME_LEASE_MS,
	reserve_runtime_ownership,
	transition_runtime,
} from './ownership.js';
import type { RuntimeHostConfig } from './protocol.js';

function runtime_endpoint(session_id: string, runtime_id: string): string {
	const key = createHash('sha256')
		.update(`${session_id}:${runtime_id}`)
		.digest('hex')
		.slice(0, 24);
	return join(tmpdir(), `pi-team-runtime-${key}.sock`);
}

export function encode_runtime_host_config(config: RuntimeHostConfig): string {
	return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}

export function decode_runtime_host_config(value: string): RuntimeHostConfig {
	const parsed = JSON.parse(
		Buffer.from(value, 'base64url').toString('utf8'),
	) as RuntimeHostConfig;
	if (
		!parsed.db_path ||
		!parsed.session_id ||
		!parsed.session_file ||
		!parsed.cwd ||
		!parsed.runtime_id ||
		!parsed.endpoint ||
		!Number.isInteger(parsed.generation)
	)
		throw new Error('Invalid persistent runtime host configuration');
	return parsed;
}

export interface StartPersistentRuntimeOptions {
	db_path: string;
	session_id: string;
	session_file: string;
	cwd: string;
	initial_prompt?: string;
	member?: string;
	from_session_id?: string;
	report_to_session_ids?: string[];
	timeout_ms?: number;
	lease_ms?: number;
	heartbeat_ms?: number;
	host_module?: string;
}

export async function start_persistent_runtime(
	options: StartPersistentRuntimeOptions,
): Promise<CoordinationSessionRuntime> {
	const runtime_id = randomUUID();
	const endpoint = runtime_endpoint(options.session_id, runtime_id);
	const lease_ms = options.lease_ms ?? DEFAULT_RUNTIME_LEASE_MS;
	const db = await TeamDatabase.open(options.db_path);
	let reserved: CoordinationSessionRuntime;
	try {
		reserved = reserve_runtime_ownership(db, {
			session_id: options.session_id,
			runtime_id,
			endpoint,
			lease_ms,
		});
	} finally {
		db.close();
	}
	const config: RuntimeHostConfig = {
		db_path: options.db_path,
		session_id: options.session_id,
		session_file: options.session_file,
		cwd: options.cwd,
		runtime_id,
		generation: reserved.generation,
		endpoint,
		initial_prompt: options.initial_prompt,
		member: options.member,
		from_session_id: options.from_session_id,
		report_to_session_ids: options.report_to_session_ids,
		lease_ms,
		heartbeat_ms: options.heartbeat_ms,
	};
	const host_module =
		options.host_module ?? fileURLToPath(new URL('./host.js', import.meta.url));
	const child = spawn(
		process.execPath,
		[
			host_module,
			'--config',
			encode_runtime_host_config(config),
			'--runtime-id',
			runtime_id,
		],
		{
			cwd: options.cwd,
			detached: true,
			stdio: 'ignore',
			env: {
				...process.env,
				[AUTO_INJECT_ENV]: 'false',
				[TEAM_ROLE_ENV]: 'teammate',
				[TEAM_MEMBER_ENV]: options.member ?? 'teammate',
			},
		},
	);
	child.unref();
	child.once('error', (error) => {
		void TeamDatabase.open(options.db_path).then((failure_db) => {
			try {
				transition_runtime(failure_db, {
					session_id: options.session_id,
					runtime_id,
					generation: reserved.generation,
					state: 'failed',
					error: `Runtime host spawn failed: ${error.message}`,
					diagnostics: [error.stack ?? error.message],
				});
			} finally {
				failure_db.close();
			}
		});
	});
	return await wait_for_runtime_ready({
		db_path: options.db_path,
		session_id: options.session_id,
		runtime_id,
		generation: reserved.generation,
		timeout_ms: options.timeout_ms,
	});
}
