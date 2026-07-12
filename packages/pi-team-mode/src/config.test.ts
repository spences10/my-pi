import { afterEach, describe, expect, it } from 'vitest';
import {
	AUTO_INJECT_ENV,
	COORDINATION_DB_ENV,
	get_coordination_db_path,
	should_auto_inject_messages,
} from './config.js';

const original_auto_inject = process.env[AUTO_INJECT_ENV];
const original_db_path = process.env[COORDINATION_DB_ENV];

afterEach(() => {
	if (original_auto_inject === undefined)
		delete process.env[AUTO_INJECT_ENV];
	else process.env[AUTO_INJECT_ENV] = original_auto_inject;
	if (original_db_path === undefined)
		delete process.env[COORDINATION_DB_ENV];
	else process.env[COORDINATION_DB_ENV] = original_db_path;
});

describe('team-mode configuration', () => {
	it('supports disabling automatic peer-message injection', () => {
		delete process.env[AUTO_INJECT_ENV];
		expect(should_auto_inject_messages()).toBe(true);
		process.env[AUTO_INJECT_ENV] = 'false';
		expect(should_auto_inject_messages()).toBe(false);
	});

	it('supports an isolated coordination database', () => {
		process.env[COORDINATION_DB_ENV] = '/tmp/team-mode-peer.db';
		expect(get_coordination_db_path()).toBe('/tmp/team-mode-peer.db');
	});
});
