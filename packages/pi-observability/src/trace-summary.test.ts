import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { trace_summary } from './trace-summary.js';
import type {
	DashboardSession,
	ObservabilityEvent,
} from './types.js';

const dirs: string[] = [];

function event(
	type: ObservabilityEvent['type'],
	seq: number,
	payload: Record<string, unknown>,
	ts = `2026-01-01T00:00:0${seq}.000Z`,
): ObservabilityEvent {
	return {
		event_id: `event-${seq}`,
		session_id: 'session-1',
		seq,
		ts,
		type,
		cwd: '/repo',
		pool: 'default',
		tags: [],
		payload,
	};
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('trace_summary', () => {
	it('summarizes spans, elapsed time, token usage, and errors', () => {
		const summary = trace_summary(null, [
			event(
				'tool_result',
				2,
				{
					toolCallId: 'call-1',
					toolName: 'bash',
					message: 'error: failed',
				},
				'2026-01-01T00:00:02.000Z',
			),
			event(
				'tool_call',
				1,
				{
					toolCallId: 'call-1',
					toolName: 'bash',
					usage: { input_tokens: 10, output_tokens: 5 },
				},
				'2026-01-01T00:00:01.000Z',
			),
			event(
				'provider_response',
				0,
				{
					id: 'provider-1',
					name: 'anthropic',
					usage: { totalTokens: '20' },
					cost: { total: '0.01' },
				},
				'2026-01-01T00:00:00.000Z',
			),
		]);

		expect(summary.metrics).toMatchObject({
			events: 3,
			elapsed_ms: 2000,
			tools: 1,
			errors: 1,
			input_tokens: 20,
			output_tokens: 10,
			total_tokens: 20,
			cost_usd: 0.01,
			blocking_ms: 1000,
		});
		expect(summary.spans[0]).toMatchObject({
			id: 'tool:call-1',
			kind: 'tool',
			name: 'bash',
			duration_ms: 1000,
			error: true,
			event_count: 2,
		});
	});

	it('falls back to session-file usage when events have no usage metrics', () => {
		const dir = mkdtempSync(
			join(tmpdir(), 'pi-observability-trace-'),
		);
		dirs.push(dir);
		const session_file = join(dir, 'session.jsonl');
		writeFileSync(
			session_file,
			JSON.stringify({
				message: {
					usage: {
						input: 7,
						output: 3,
						totalTokens: 10,
						cost: { total: 0.02 },
					},
				},
			}) + '\n',
		);
		const session: DashboardSession = {
			session_id: 'session-1',
			session_file,
			cwd: '/repo',
			pool: 'default',
			tags: [],
			last_ts: 'now',
			event_count: 1,
		};

		expect(
			trace_summary(session, [event('message_start', 0, {})]).metrics,
		).toMatchObject({
			input_tokens: 7,
			output_tokens: 3,
			total_tokens: 10,
			cost_usd: 0.02,
		});
	});
});
