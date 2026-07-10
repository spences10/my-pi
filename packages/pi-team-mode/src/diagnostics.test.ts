import { describe, expect, it } from 'vitest';
import {
	sanitize_diagnostic_stream,
	sanitize_process_diagnostics,
} from './diagnostics.js';

describe('safe Team Mode diagnostics', () => {
	it('redacts common secret forms before returning diagnostic text', () => {
		const result = sanitize_diagnostic_stream(
			[
				'Authorization: Bearer visible-token',
				'OPENAI_API_KEY=visible-key',
				'DATABASE_URL=postgres://user:password@localhost/db',
				'https://user:password@example.com/path',
			].join('\n'),
		);

		expect(result.text).not.toMatch(
			/visible-token|visible-key|user:password/,
		);
		expect(result.text).toContain('[REDACTED]');
		expect(result.redaction_count).toBeGreaterThanOrEqual(4);
	});

	it('bounds UTF-8 output by bytes and records truncation metadata', () => {
		const result = sanitize_diagnostic_stream('🙂🙂🙂', 5);

		expect(result).toMatchObject({
			text: '🙂',
			bytes: 12,
			stored_bytes: 4,
			truncated: true,
		});
	});

	it('returns structured process outcomes without an unredacted copy', () => {
		const result = sanitize_process_diagnostics(
			{
				command: 'curl -H "Authorization: Bearer command-token"',
				exit_code: null,
				signal: 'SIGTERM',
				timed_out: true,
				stdout: 'API_TOKEN=stdout-token',
				stderr: 'x'.repeat(20),
			},
			8,
		);

		expect(result).toMatchObject({
			exit_code: null,
			signal: 'SIGTERM',
			timed_out: true,
			stdout: { truncated: true },
			stderr: { stored_bytes: 8, truncated: true },
		});
		expect(JSON.stringify(result)).not.toMatch(
			/command-token|stdout-token/,
		);
	});
});
