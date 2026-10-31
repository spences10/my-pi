import { describe, expect, it } from 'vite-plus/test';
import {
	derive_event_columns,
	EVENT_COLUMN_NAMES,
	event_column_values,
} from './event-columns.js';

describe('derive_event_columns', () => {
	it('reads tool identity, outcome, and duration', () => {
		expect(
			derive_event_columns('tool_execution_end', {
				toolCallId: 'c1',
				toolName: 'read',
				isError: false,
				durationMs: 12.5,
			}),
		).toMatchObject({
			tool_call_id: 'c1',
			tool_name: 'read',
			is_error: 0,
			duration_ms: 12.5,
			input_tokens: null,
		});
	});

	it('reads usage, latency, and stop reason from message_end only', () => {
		const payload = {
			message: {
				role: 'assistant',
				stopReason: 'error',
				durationMs: 900,
				usage: {
					input: 10,
					output: 2,
					cacheRead: 3,
					cacheWrite: 4,
					cost: { total: 0.5 },
				},
			},
		};
		expect(
			derive_event_columns('message_end', payload),
		).toMatchObject({
			stop_reason: 'error',
			is_error: 1,
			duration_ms: 900,
			input_tokens: 10,
			output_tokens: 2,
			cache_read_tokens: 3,
			cache_write_tokens: 4,
			cost_usd: 0.5,
		});
		expect(derive_event_columns('turn_end', payload)).toMatchObject({
			stop_reason: 'error',
			input_tokens: null,
			cost_usd: null,
		});
	});

	it('ignores durationMs on toolResult messages', () => {
		expect(
			derive_event_columns('message_end', {
				message: { role: 'toolResult', durationMs: 5019 },
			}).duration_ms,
		).toBeNull();
	});

	it('returns nulls for truncated or unknown payloads', () => {
		const columns = derive_event_columns('tool_result', {
			truncated: true,
			preview: '{"toolName":"bash"',
		});
		expect(event_column_values(columns)).toEqual(
			EVENT_COLUMN_NAMES.map(() => null),
		);
		expect(
			event_column_values(derive_event_columns('custom', 'text')),
		).toHaveLength(EVENT_COLUMN_NAMES.length);
	});
});
