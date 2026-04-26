import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_working_indicator_config_path,
	load_working_indicator_config,
	save_working_indicator_config,
} from './config.js';

function tmp_home(): string {
	const dir = join(
		tmpdir(),
		`my-pi-working-indicator-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('working indicator config', () => {
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

	it('defaults to pi spinner when missing', () => {
		const home = tmp_home();
		homes.push(home);
		process.env.HOME = home;

		expect(load_working_indicator_config()).toEqual({
			version: 1,
			mode: 'default',
		});
		expect(get_working_indicator_config_path()).toBe(
			join(home, '.pi', 'agent', 'working-indicator.json'),
		);
	});

	it('saves config atomically', () => {
		const home = tmp_home();
		homes.push(home);
		process.env.HOME = home;

		save_working_indicator_config({ version: 1, mode: 'dot' });

		const path = get_working_indicator_config_path();
		expect(existsSync(path)).toBe(true);
		expect(load_working_indicator_config()).toEqual({
			version: 1,
			mode: 'dot',
		});
		expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
			version: 1,
			mode: 'dot',
		});
	});
});
