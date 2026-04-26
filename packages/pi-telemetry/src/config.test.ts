import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_default_telemetry_db_path,
	get_telemetry_config_path,
	load_telemetry_config,
	resolve_telemetry_db_path,
	resolve_telemetry_enabled,
	save_telemetry_config,
} from './config.js';

function tmp_home(): string {
	const dir = join(
		tmpdir(),
		`my-pi-telemetry-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('telemetry config', () => {
	const homes: string[] = [];
	const original_home = process.env.HOME;

	afterEach(() => {
		for (const home of homes.splice(0)) {
			rmSync(home, { recursive: true, force: true });
		}
		if (original_home === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = original_home;
		}
	});

	it('defaults to disabled when missing', () => {
		const home = tmp_home();
		homes.push(home);
		process.env.HOME = home;

		expect(load_telemetry_config()).toEqual({
			version: 1,
			enabled: false,
		});
		expect(get_telemetry_config_path()).toBe(
			join(home, '.pi', 'agent', 'telemetry.json'),
		);
		expect(get_default_telemetry_db_path()).toBe(
			join(home, '.pi', 'agent', 'telemetry.db'),
		);
	});

	it('saves config atomically', () => {
		const home = tmp_home();
		homes.push(home);
		process.env.HOME = home;

		save_telemetry_config({ version: 1, enabled: true });

		const path = get_telemetry_config_path();
		expect(existsSync(path)).toBe(true);
		expect(load_telemetry_config()).toEqual({
			version: 1,
			enabled: true,
		});
		expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
			version: 1,
			enabled: true,
		});
	});

	it('resolves db path from cwd for overrides', () => {
		const cwd = '/tmp/project';
		expect(resolve_telemetry_db_path(cwd, './runs.db')).toBe(
			join(cwd, 'runs.db'),
		);
		expect(resolve_telemetry_db_path(cwd, '/tmp/runs.db')).toBe(
			'/tmp/runs.db',
		);
	});

	it('applies process overrides over saved config', () => {
		expect(
			resolve_telemetry_enabled({ version: 1, enabled: false }),
		).toBe(false);
		expect(
			resolve_telemetry_enabled({ version: 1, enabled: false }, true),
		).toBe(true);
		expect(
			resolve_telemetry_enabled({ version: 1, enabled: true }, false),
		).toBe(false);
	});
});
