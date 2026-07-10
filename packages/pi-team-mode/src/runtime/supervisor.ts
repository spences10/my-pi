import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	mkdtempSync,
	readFileSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create_team_child_env } from '../child-env.js';
import {
	AUTO_INJECT_ENV,
	COORDINATION_DB_ENV,
	EXTENSION_PATH_ENV,
	get_extension_path,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from '../config.js';
import type { CoordinationSessionRuntime } from '../db/index.js';
import { TeamDatabase } from '../db/index.js';
import { prompt_runtime, wait_for_runtime_ready } from './client.js';
import {
	DEFAULT_RUNTIME_LEASE_MS,
	reserve_runtime_ownership,
	transition_runtime,
} from './ownership.js';
import type { RuntimeHostConfig } from './protocol.js';

function runtime_endpoint(
	session_id: string,
	runtime_id: string,
): string {
	const key = createHash('sha256')
		.update(`${session_id}:${runtime_id}`)
		.digest('hex')
		.slice(0, 24);
	return join(tmpdir(), `pi-team-runtime-${key}.sock`);
}

export function encode_runtime_host_config(
	config: RuntimeHostConfig,
): string {
	return Buffer.from(JSON.stringify(config), 'utf8').toString(
		'base64url',
	);
}

export function decode_runtime_host_config(
	value: string,
): RuntimeHostConfig {
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
		!parsed.extension_path ||
		!Number.isInteger(parsed.generation)
	)
		throw new Error('Invalid persistent runtime host configuration');
	return parsed;
}

export function write_runtime_host_config(
	config: RuntimeHostConfig,
): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-runtime-config-'));
	const path = join(dir, 'config');
	writeFileSync(path, encode_runtime_host_config(config), {
		mode: 0o600,
	});
	return path;
}

export function consume_runtime_host_config(
	path: string,
): RuntimeHostConfig {
	try {
		return decode_runtime_host_config(readFileSync(path, 'utf8'));
	} finally {
		rmSync(path, { force: true });
		rmdirSync(dirname(path));
	}
}

export function runtime_host_args(
	host_module: string,
	config_path: string,
	runtime_id: string,
): string[] {
	return [
		host_module,
		'--config-file',
		config_path,
		'--runtime-id',
		runtime_id,
	];
}

export interface StartPersistentRuntimeOptions {
	db_path: string;
	session_id: string;
	session_file: string;
	cwd: string;
	initial_prompt?: string;
	member?: string;
	role?: 'lead' | 'teammate' | 'peer';
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
		extension_path: get_extension_path(),
		member: options.member,
		role: options.role,
		from_session_id: options.from_session_id,
		report_to_session_ids: options.report_to_session_ids,
		lease_ms,
		heartbeat_ms: options.heartbeat_ms,
	};
	const host_module =
		options.host_module ??
		fileURLToPath(new URL('./host.js', import.meta.url));
	const config_path = write_runtime_host_config(config);
	const child = spawn(
		process.execPath,
		runtime_host_args(host_module, config_path, runtime_id),
		{
			cwd: options.cwd,
			detached: true,
			stdio: 'ignore',
			env: create_team_child_env({
				explicit_env: {
					[AUTO_INJECT_ENV]: 'false',
					[COORDINATION_DB_ENV]: options.db_path,
					[EXTENSION_PATH_ENV]: config.extension_path,
					MY_PI_TEAM_RUNTIME: 'persistent',
					[TEAM_ROLE_ENV]: options.role ?? 'teammate',
					[TEAM_MEMBER_ENV]: options.member ?? 'teammate',
				},
			}),
		},
	);
	child.unref();
	child.once('error', (error) => {
		rmSync(config_path, { force: true });
		try {
			rmdirSync(dirname(config_path));
		} catch {}
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
	const ready = await wait_for_runtime_ready({
		db_path: options.db_path,
		session_id: options.session_id,
		runtime_id,
		generation: reserved.generation,
		timeout_ms: options.timeout_ms,
	});
	return options.initial_prompt?.trim()
		? await prompt_runtime(
				ready,
				options.initial_prompt,
				options.timeout_ms,
			)
		: ready;
}
