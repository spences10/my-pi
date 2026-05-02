import { describe, expect, it } from 'vitest';
import {
	summarize_provider_payload,
	summarize_tool_args,
	summarize_tool_result,
} from './summaries.js';

describe('telemetry summaries', () => {
	it('summarizes bash commands without storing command text', () => {
		const summary = JSON.parse(
			summarize_tool_args('bash', {
				command: `secret-token-${'x'.repeat(100)}`,
				timeout: 120,
			})!,
		) as {
			command: { type: string; bytes: number };
			timeout: number;
		};

		expect(summary.timeout).toBe(120);
		expect(summary.command.type).toBe('string');
		expect(summary.command.bytes).toBeGreaterThan(100);
		expect(JSON.stringify(summary)).not.toContain('secret-token');
	});

	it('summarizes tool results and provider payloads', () => {
		expect(
			JSON.parse(summarize_tool_result(['a', 'b'])!),
		).toMatchObject({
			type: 'array',
			length: 2,
		});
		expect(
			JSON.parse(summarize_provider_payload({ text: 'hello' })!),
		).toMatchObject({
			type: 'object',
			keys: ['text'],
			text_summary: { type: 'string', bytes: 5, lines: 1 },
		});
	});
});
