import { describe, expect, it } from 'vitest';
import {
	format_telemetry_status,
	parse_telemetry_command,
} from './commands.js';

describe('telemetry commands', () => {
	it('parses query filters with default limit', () => {
		expect(
			parse_telemetry_command('query suite=smoke success=false'),
		).toMatchObject({
			subcommand: 'query',
			filters: {
				eval_suite: 'smoke',
				success: false,
				limit: 20,
			},
			errors: [],
		});
	});

	it('reports invalid filters', () => {
		expect(
			parse_telemetry_command('query success=maybe limit=0'),
		).toMatchObject({
			errors: [
				'Invalid success value: maybe. Use true, false, or null',
				'Invalid limit value: 0. Use a positive integer',
			],
		});
	});

	it('formats effective telemetry status', () => {
		expect(
			format_telemetry_status({
				saved_enabled: true,
				effective_enabled: false,
				override: false,
				db_path: '/tmp/pi.db',
			}),
		).toBe(
			[
				'telemetry disabled now',
				'default enabled',
				'override --no-telemetry',
				'db /tmp/pi.db',
			].join('\n'),
		);
	});
});
