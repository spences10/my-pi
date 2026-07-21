import { afterEach, describe, expect, it } from 'vitest';
import {
	get_startup_coordination_retention_ms,
	TEAM_RETENTION_DAYS_ENV,
} from './retention.js';

const original_retention = process.env[TEAM_RETENTION_DAYS_ENV];

afterEach(() => {
	if (original_retention === undefined)
		delete process.env[TEAM_RETENTION_DAYS_ENV];
	else process.env[TEAM_RETENTION_DAYS_ENV] = original_retention;
});

describe('startup coordination retention', () => {
	it('does not prune by default', () => {
		delete process.env[TEAM_RETENTION_DAYS_ENV];
		expect(get_startup_coordination_retention_ms()).toBeUndefined();
	});

	it.each([
		'',
		'   ',
		'0',
		'0.0',
		'-0',
		'off',
		'OFF',
		'false',
		'disabled',
		'-1',
		'invalid',
		'Infinity',
		'1e308',
	])(
		'does not prune for disabled or unsafe setting %j',
		(configured) => {
			process.env[TEAM_RETENTION_DAYS_ENV] = configured;
			expect(get_startup_coordination_retention_ms()).toBeUndefined();
		},
	);

	it('enables startup pruning for a valid positive day count', () => {
		process.env[TEAM_RETENTION_DAYS_ENV] = '7.5';
		expect(get_startup_coordination_retention_ms()).toBe(
			7.5 * 24 * 60 * 60 * 1000,
		);
	});
});
