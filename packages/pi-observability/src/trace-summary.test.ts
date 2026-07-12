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
	it('reports truthful turn, tool outcome, duration, and structured error metrics', () => {
		const summary = trace_summary(null, [
			event('turn_start', 0, {}),
			event('tool_call', 1, {
				toolCallId: 'call-1',
				toolName: 'bash',
			}),
			event('tool_execution_start', 2, {
				toolCallId: 'call-1',
				toolName: 'bash',
			}),
			event(
				'tool_execution_end',
				3,
				{ toolCallId: 'call-1', toolName: 'bash', isError: true },
				'2026-01-01T00:00:05.000Z',
			),
			event('tool_result', 4, {
				toolCallId: 'call-1',
				toolName: 'bash',
				message: 'error text is not independently significant',
			}),
			event('turn_start', 5, {}),
			event('tool_execution_start', 6, {
				toolCallId: 'call-2',
				toolName: 'bash',
			}),
			event(
				'tool_execution_end',
				7,
				{ toolCallId: 'call-2', toolName: 'bash', status: 'ok' },
				'2026-01-01T00:00:08.000Z',
			),
		]);

		expect(summary.metrics).toMatchObject({
			turns: 2,
			tool_calls: 2,
			tool_failures: 1,
			errors: 1,
		});
		expect(summary.tools).toEqual([
			{
				name: 'bash',
				calls: 2,
				errors: 1,
				total_duration_ms: 5000,
				avg_duration_ms: 2500,
				max_duration_ms: 3000,
			},
		]);
		expect(summary.spans.map((span) => span.duration_ms)).toEqual([
			3000, 2000,
		]);
	});

	it('never treats error-like text as a structured failure', () => {
		const summary = trace_summary(null, [
			event('tool_call', 0, {
				toolCallId: 'call-1',
				toolName: 'read',
			}),
			event('tool_result', 1, {
				toolCallId: 'call-1',
				toolName: 'read',
				message: 'documentation about error handling',
			}),
		]);
		expect(summary.metrics.tool_failures).toBe(0);
		expect(summary.metrics.errors).toBe(0);
		expect(summary.spans[0]?.error).toBe(false);
	});

	it('prefers session-file usage and avoids duplicated lifecycle usage', () => {
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
			first_ts: 'then',
			last_ts: 'now',
			event_count: 1,
		};
		const duplicate_usage = {
			usage: {
				input: 100,
				output: 50,
				totalTokens: 150,
				cost: { total: 1 },
			},
		};

		expect(
			trace_summary(session, [
				event('message_end', 0, duplicate_usage),
				event('provider_response', 1, duplicate_usage),
			]).metrics,
		).toMatchObject({
			input_tokens: 7,
			output_tokens: 3,
			total_tokens: 10,
			cost_usd: 0.02,
		});
	});

	it('falls back to message_end usage only when the session file is unavailable', () => {
		const usage = {
			usage: {
				input: 11,
				output: 4,
				totalTokens: 15,
				cost: { total: 0.03 },
			},
		};
		const summary = trace_summary(null, [
			event('message_end', 0, usage),
			event('provider_response', 1, usage),
		]);
		expect(summary.metrics).toMatchObject({
			input_tokens: 11,
			output_tokens: 4,
			total_tokens: 15,
			cost_usd: 0.03,
		});
	});
});
