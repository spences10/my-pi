import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import {
	summarizable_schema,
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

describe('summarizable_schema', () => {
	it('passes through any runtime value and maps NaN to null', () => {
		expect(v.parse(summarizable_schema, { a: 1 })).toEqual({ a: 1 });
		expect(v.parse(summarizable_schema, [1, 'b'])).toEqual([1, 'b']);
		expect(v.parse(summarizable_schema, 'text')).toBe('text');
		expect(v.parse(summarizable_schema, undefined)).toBeUndefined();
		expect(v.parse(summarizable_schema, Number.NaN)).toBeNull();
	});
});
