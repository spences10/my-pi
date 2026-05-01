import { afterEach, describe, expect, it } from 'vitest';
import {
	EXTENSION_PATH_ENV,
	get_extension_path,
	set_current_extension_path,
} from './config.js';

const original_env_value = process.env[EXTENSION_PATH_ENV];

afterEach(() => {
	if (original_env_value === undefined) {
		delete process.env[EXTENSION_PATH_ENV];
	} else {
		process.env[EXTENSION_PATH_ENV] = original_env_value;
	}
	set_current_extension_path('');
});

describe('team-mode extension path', () => {
	it('uses the active extension entry path instead of the config module path', () => {
		delete process.env[EXTENSION_PATH_ENV];
		set_current_extension_path(
			'/repo/packages/pi-team-mode/dist/index.js',
		);

		expect(get_extension_path()).toBe(
			'/repo/packages/pi-team-mode/dist/index.js',
		);
	});

	it('lets the explicit environment override win for child teammates', () => {
		process.env[EXTENSION_PATH_ENV] = '/tmp/team-extension.js';
		set_current_extension_path(
			'/repo/packages/pi-team-mode/dist/index.js',
		);

		expect(get_extension_path()).toBe('/tmp/team-extension.js');
	});
});
