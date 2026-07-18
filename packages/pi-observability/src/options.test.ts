import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	resolve_observability_server_options,
	resolve_observability_token,
} from './options.js';

describe('resolve_observability_server_options', () => {
	it('generates and reuses a private local token by default', () => {
		const home = mkdtempSync(join(tmpdir(), 'pi-obs-options-'));
		const env = { HOME: home };
		const options = resolve_observability_server_options(env);
		const token_path = join(
			home,
			'.pi',
			'agent',
			'observability-token',
		);

		expect(options).toMatchObject({
			host: '127.0.0.1',
			port: 43190,
			log: true,
			retention_days: 14,
			max_events: 100_000,
		});
		expect(options.token).toHaveLength(43);
		expect(resolve_observability_token(env)).toBe(options.token);
		expect(readFileSync(token_path, 'utf8').trim()).toBe(
			options.token,
		);
		expect(statSync(token_path).mode & 0o777).toBe(0o600);
		expect(options.db_path).toContain('.pi/agent/observability.db');
	});

	it('parses valid environment overrides', () => {
		expect(
			resolve_observability_server_options({
				MY_PI_OBSERVABILITY_HOST: '0.0.0.0',
				MY_PI_OBSERVABILITY_PORT: '43210',
				MY_PI_OBSERVABILITY_TOKEN: 'secret',
				MY_PI_OBSERVABILITY_DB: './local.db',
				MY_PI_OBSERVABILITY_LOG: '0',
				MY_PI_OBSERVABILITY_RETENTION_DAYS: '3',
				MY_PI_OBSERVABILITY_MAX_EVENTS: '25',
			}),
		).toMatchObject({
			host: '0.0.0.0',
			port: 43210,
			token: 'secret',
			log: false,
			retention_days: 3,
			max_events: 25,
		});
	});

	it('falls back for invalid integers and ports', () => {
		expect(
			resolve_observability_server_options({
				MY_PI_OBSERVABILITY_PORT: '70000',
				MY_PI_OBSERVABILITY_RETENTION_DAYS: '0',
				MY_PI_OBSERVABILITY_MAX_EVENTS: 'nope',
				MY_PI_OBSERVABILITY_TOKEN: 'configured-value',
			}),
		).toMatchObject({
			port: 43190,
			retention_days: 14,
			max_events: 100_000,
		});
	});
});
