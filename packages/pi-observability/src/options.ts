import { randomBytes } from 'node:crypto';
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ObservabilityServerOptions } from './server-options.js';

function parse_positive_integer(
	value: string | undefined,
	fallback: number,
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed) || parsed < 1) return fallback;
	return parsed;
}

function parse_port(value: string | undefined): number {
	const port = parse_positive_integer(value, 43190);
	if (port > 65535) return 43190;
	return port;
}

export function generate_observability_token(): string {
	return randomBytes(32).toString('base64url');
}

function default_token_path(env: NodeJS.ProcessEnv): string {
	const agent_dir =
		env.PI_CODING_AGENT_DIR ??
		join(env.HOME ?? homedir(), '.pi', 'agent');
	return resolve(
		env.MY_PI_OBSERVABILITY_TOKEN_FILE ??
			join(agent_dir, 'observability-token'),
	);
}

export function resolve_observability_token(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configured = env.MY_PI_OBSERVABILITY_TOKEN?.trim();
	if (configured) return configured;

	const path = default_token_path(env);
	try {
		const existing = readFileSync(path, 'utf8').trim();
		if (!existing)
			throw new Error(`Observability token file is empty: ${path}`);
		chmodSync(path, 0o600);
		return existing;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
			throw error;
	}

	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const generated = generate_observability_token();
	try {
		writeFileSync(path, `${generated}\n`, {
			encoding: 'utf8',
			flag: 'wx',
			mode: 0o600,
		});
		return generated;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
			throw error;
		const existing = readFileSync(path, 'utf8').trim();
		if (!existing)
			throw new Error(`Observability token file is empty: ${path}`);
		chmodSync(path, 0o600);
		return existing;
	}
}

export function resolve_observability_server_options(
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityServerOptions {
	return {
		host: env.MY_PI_OBSERVABILITY_HOST ?? '127.0.0.1',
		port: parse_port(env.MY_PI_OBSERVABILITY_PORT),
		token: resolve_observability_token(env),
		db_path: resolve(
			env.MY_PI_OBSERVABILITY_DB ??
				`${homedir()}/.pi/agent/observability.db`,
		),
		log: env.MY_PI_OBSERVABILITY_LOG !== '0',
		retention_days: parse_positive_integer(
			env.MY_PI_OBSERVABILITY_RETENTION_DAYS,
			14,
		),
		max_events: parse_positive_integer(
			env.MY_PI_OBSERVABILITY_MAX_EVENTS,
			100_000,
		),
		max_body_bytes: parse_positive_integer(
			env.MY_PI_OBSERVABILITY_MAX_BODY_BYTES,
			1_048_576,
		),
	};
}
