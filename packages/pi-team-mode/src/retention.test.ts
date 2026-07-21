import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_COORDINATION_RETENTION_MS,
	get_coordination_retention_ms,
	TEAM_RETENTION_DAYS_ENV,
} from './retention.js';

const original_retention = process.env[TEAM_RETENTION_DAYS_ENV];

afterEach(() => {
	if (original_retention === undefined)
		delete process.env[TEAM_RETENTION_DAYS_ENV];
	else process.env[TEAM_RETENTION_DAYS_ENV] = original_retention;
});

describe('coordination retention', () => {
	it('defaults to thirty days and accepts a positive day override', () => {
		delete process.env[TEAM_RETENTION_DAYS_ENV];
		expect(get_coordination_retention_ms()).toBe(
			DEFAULT_COORDINATION_RETENTION_MS,
		);

		process.env[TEAM_RETENTION_DAYS_ENV] = '7.5';
		expect(get_coordination_retention_ms()).toBe(
			7.5 * 24 * 60 * 60 * 1000,
		);
	});

	it('can disable startup cleanup without accepting unsafe values', () => {
		process.env[TEAM_RETENTION_DAYS_ENV] = 'off';
		expect(get_coordination_retention_ms()).toBeUndefined();

		process.env[TEAM_RETENTION_DAYS_ENV] = '-1';
		expect(get_coordination_retention_ms()).toBe(
			DEFAULT_COORDINATION_RETENTION_MS,
		);
	});
});
