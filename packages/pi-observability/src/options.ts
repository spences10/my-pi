import { homedir } from 'node:os';
import { resolve } from 'node:path';
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

export function resolve_observability_server_options(
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityServerOptions {
	return {
		host: env.MY_PI_OBSERVABILITY_HOST ?? '127.0.0.1',
		port: parse_port(env.MY_PI_OBSERVABILITY_PORT),
		token: env.MY_PI_OBSERVABILITY_TOKEN ?? '',
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
	};
}
