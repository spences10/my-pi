import { afterEach, describe, expect, it } from 'vitest';
import { temp_config } from '../test/support.js';
import {
	context_settings_from_preset,
	get_context_capture_limits,
	get_context_settings_config_path,
	load_context_settings_config,
	save_context_settings_config,
} from './config.js';
import { parse_context_retention_policy } from './policy.js';

const original_config = process.env.MY_PI_CONTEXT_CONFIG;
const original_retention_days =
	process.env.MY_PI_CONTEXT_RETENTION_DAYS;
const original_max_mb = process.env.MY_PI_CONTEXT_MAX_MB;
const original_purge_on_shutdown =
	process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;
const original_capture_max_kb =
	process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB;
const original_capture_max_lines =
	process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES;

afterEach(() => {
	if (original_config === undefined)
		delete process.env.MY_PI_CONTEXT_CONFIG;
	else process.env.MY_PI_CONTEXT_CONFIG = original_config;
	if (original_retention_days === undefined)
		delete process.env.MY_PI_CONTEXT_RETENTION_DAYS;
	else
		process.env.MY_PI_CONTEXT_RETENTION_DAYS =
			original_retention_days;
	if (original_max_mb === undefined)
		delete process.env.MY_PI_CONTEXT_MAX_MB;
	else process.env.MY_PI_CONTEXT_MAX_MB = original_max_mb;
	if (original_purge_on_shutdown === undefined)
		delete process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;
	else
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN =
			original_purge_on_shutdown;
	if (original_capture_max_kb === undefined)
		delete process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB;
	else
		process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB =
			original_capture_max_kb;
	if (original_capture_max_lines === undefined)
		delete process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES;
	else
		process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES =
			original_capture_max_lines;
});

describe('context settings config', () => {
	it('saves and loads preset settings', () => {
		process.env.MY_PI_CONTEXT_CONFIG = temp_config();
		const config = context_settings_from_preset('balanced');

		save_context_settings_config(config);

		expect(get_context_settings_config_path()).toBe(
			process.env.MY_PI_CONTEXT_CONFIG,
		);
		expect(load_context_settings_config()).toEqual(config);
	});

	it('uses saved capture limits and lets env override them', () => {
		process.env.MY_PI_CONTEXT_CONFIG = temp_config();
		save_context_settings_config(
			context_settings_from_preset('light'),
		);

		expect(get_context_capture_limits()).toEqual({
			max_bytes: 16 * 1024,
			max_lines: 200,
		});

		process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB = '64';
		process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES = '700';

		expect(get_context_capture_limits()).toEqual({
			max_bytes: 64 * 1024,
			max_lines: 700,
		});
	});

	it('uses saved settings as policy fallback and lets env override them', () => {
		process.env.MY_PI_CONTEXT_CONFIG = temp_config();
		save_context_settings_config(
			context_settings_from_preset('light'),
		);

		expect(parse_context_retention_policy()).toMatchObject({
			retention_days: 1,
			max_mb: 50,
			purge_on_shutdown: false,
		});

		process.env.MY_PI_CONTEXT_RETENTION_DAYS = '30';
		process.env.MY_PI_CONTEXT_MAX_MB = '1024';
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN = 'true';

		expect(parse_context_retention_policy()).toMatchObject({
			retention_days: 30,
			max_mb: 1024,
			purge_on_shutdown: true,
		});
	});
});
