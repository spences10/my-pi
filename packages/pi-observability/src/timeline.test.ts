import { describe, expect, it } from 'vite-plus/test';
import { derive_event_columns } from './event-columns.js';
import { summarize_payload } from './index.js';
import { build_timeline, type TimelineEventRow } from './timeline.js';

let seq = 0;

function row(
	second: number,
	type: string,
	payload: Record<string, unknown> = {},
): TimelineEventRow {
	const columns = derive_event_columns(type, payload);

	return {
		seq: seq++,
		ts: new Date(Date.UTC(2026, 9, 31, 10, 0, second)).toISOString(),
		type,
		payload_json: JSON.stringify(payload),
		model: 'gpt-test',
		tool_call_id: columns.tool_call_id,
		tool_name: columns.tool_name,
		is_error: columns.is_error,
		duration_ms: columns.duration_ms,
		stop_reason: columns.stop_reason,
		input_tokens: columns.input_tokens,
		output_tokens: columns.output_tokens,
		cache_read_tokens: columns.cache_read_tokens,
		cost_usd: columns.cost_usd,
		error_text: columns.error_text,
		exit_code: columns.exit_code,
		parent_tool_call_id: columns.parent_tool_call_id,
	};
}

describe('build_timeline', () => {
	it('returns no runs for a session without events', () => {
		expect(build_timeline([])).toEqual({
			start_ts: null,
			end_ms: 0,
			runs: [],
		});
	});

	it.each(['summary', 'detailed'] as const)(
		'shows model routing from %s events without replacing the requested ID',
		(detail_level) => {
			seq = 0;

			const payload = summarize_payload(
				{
					message: {
						role: 'assistant',
						model: 'virtual-model',
						responseModel: 'concrete-model',
						stopReason: 'stop',
					},
				},
				detail_level,
			) as Record<string, unknown>;

			const timeline = build_timeline([
				row(0, 'agent_start'),
				row(0, 'turn_start'),
				{ ...row(1, 'provider_request'), model: 'virtual-model' },
				row(2, 'message_end', payload),
				row(3, 'turn_end'),
				row(3, 'agent_end'),
			]);

			expect(
				timeline.runs[0]!.children[0]!.children[0],
			).toMatchObject({
				name: 'virtual-model → concrete-model',
				requested_model: 'virtual-model',
				response_model: 'concrete-model',
				open: false,
			});
		},
	);

	it.each([undefined, '', 42, 'gpt-test'])(
		'does not duplicate labels or invent missing responding models (%s)',
		(response_model) => {
			const timeline = build_timeline([
				row(0, 'provider_request'),
				row(1, 'message_end', {
					message: {
						role: 'assistant',
						model: 'gpt-test',
						responseModel: response_model,
						stopReason: 'stop',
					},
				}),
			]);

			const model = timeline.runs[0]!.children[0]!;
			expect(model.name).toBe('gpt-test');
			expect(model.requested_model).toBe('gpt-test');
			expect(model.response_model).toBe(
				response_model === 'gpt-test' ? 'gpt-test' : undefined,
			);
		},
	);

	it.each(['detailed', 'raw', 'summary', 'historical'])(
		'exposes response text from %s events without inventing missing content',
		(mode) => {
			const message = {
				role: 'assistant',
				stopReason: 'stop',
				content: [
					{ type: 'text', text: 'Visible answer' },
					{ type: 'thinking', thinking: 'Hidden' },
				],
			};

			let payload: Record<string, unknown>;

			if (mode === 'raw') payload = { message };
			else if (mode === 'historical')
				payload = {
					message: { role: 'assistant', stopReason: 'stop' },
				};
			else
				payload = summarize_payload(
					{ message },
					mode === 'summary' ? 'summary' : 'detailed',
					'message_end',
				) as Record<string, unknown>;

			const timeline = build_timeline([
				row(0, 'provider_request'),
				row(1, 'message_end', payload),
			]);

			const model = timeline.runs[0]!.children[0]!;
			expect(model.response_text).toBe(
				mode === 'raw' || mode === 'detailed'
					? 'Visible answer'
					: undefined,
			);
			expect(JSON.stringify(model)).not.toContain('Hidden');
		},
	);

	it('keeps responding models on their own calls across model changes', () => {
		const timeline = build_timeline([
			row(0, 'provider_request'),
			row(1, 'message_end', {
				message: {
					role: 'assistant',
					model: 'gpt-test',
					responseModel: 'actual-first',
					stopReason: 'stop',
				},
			}),
			{ ...row(2, 'provider_request'), model: 'second' },
			row(3, 'message_end', {
				message: {
					role: 'assistant',
					model: 'second',
					stopReason: 'stop',
				},
			}),
		]);

		const [first, second] = timeline.runs[0]!.children;
		expect(first).toMatchObject({
			requested_model: 'gpt-test',
			response_model: 'actual-first',
		});
		expect(second).toMatchObject({
			requested_model: 'second',
			name: 'second',
		});
		expect(second!.response_model).toBeUndefined();
	});

	it('nests runs, turns, model calls, and tool calls with failures', () => {
		seq = 0;

		const timeline = build_timeline([
			row(0, 'session_start'),
			row(1, 'agent_start', { prompt: 'Fix   the\nbuild' }),
			row(1, 'turn_start', { turnIndex: 0 }),
			row(1, 'provider_request'),
			row(3, 'message_end', {
				message: {
					role: 'assistant',
					durationMs: 1_900,
					stopReason: 'toolUse',
					usage: { input: 100, output: 10, cost: { total: 0.01 } },
				},
			}),
			row(3, 'tool_execution_start', {
				toolCallId: 'a',
				toolName: 'bash',
			}),
			row(3, 'tool_call', {
				toolCallId: 'a',
				toolName: 'bash',
				input: { command: 'ls /missing' },
			}),
			row(4, 'tool_execution_start', {
				toolCallId: 'b',
				toolName: 'read',
			}),
			row(4, 'tool_execution_start', {
				toolCallId: 'c',
				toolName: 'read',
				parentToolCallId: 'b',
			}),
			row(5, 'tool_execution_end', {
				toolCallId: 'c',
				toolName: 'read',
				isError: false,
				durationMs: 900,
			}),
			row(6, 'tool_execution_end', {
				toolCallId: 'a',
				toolName: 'bash',
				isError: true,
				durationMs: 2_950,
				errorText: 'ls: /missing: No such file',
				exitCode: 2,
				updateCount: 3,
			}),
			row(7, 'tool_execution_end', {
				toolCallId: 'b',
				toolName: 'read',
				isError: false,
			}),
			row(8, 'turn_end', {
				turnIndex: 0,
				message: { role: 'assistant', durationMs: 1_900 },
			}),
			row(8, 'agent_end'),
			row(20, 'agent_start', { prompt: 'Again' }),
			row(20, 'turn_start', { turnIndex: 0 }),
			row(21, 'provider_request'),
		]);

		expect(timeline.end_ms).toBe(21_000);
		expect(timeline.runs.map((run) => run.name)).toEqual([
			'Fix the build',
			'Again',
		]);
		const run = timeline.runs[0]!;
		expect(run).toMatchObject({
			start_ms: 1_000,
			end_ms: 8_000,
			open: false,
		});
		const turn = run.children[0]!;
		expect(turn).toMatchObject({
			kind: 'turn',
			name: 'Turn 1',
			duration_ms: 7_000,
		});
		const [model, bash, read] = turn.children;
		expect(model).toMatchObject({
			kind: 'model',
			name: 'gpt-test',
			detail: 'toolUse',
			duration_ms: 1_900,
			input_tokens: 100,
			cost_usd: 0.01,
		});
		expect(bash).toMatchObject({
			kind: 'tool',
			detail: 'ls /missing',
			duration_ms: 2_950,
			error: true,
			error_text: 'ls: /missing: No such file',
			exit_code: 2,
			update_count: 3,
			lane: 0,
		});
		// read starts while bash runs, so it takes the second row.
		expect(read).toMatchObject({
			name: 'read',
			lane: 1,
			error: false,
		});
		expect(read!.children.map((child) => child.id)).toEqual([
			'tool:c',
		]);

		const open_run = timeline.runs[1]!;
		expect(open_run.open).toBe(true);
		expect(open_run.children[0]!.children[0]).toMatchObject({
			kind: 'model',
			open: true,
			end_ms: 21_000,
		});
	});

	it('closes model calls from older events that only list message keys', () => {
		seq = 0;

		const timeline = build_timeline([
			row(0, 'agent_start', { prompt: 'Old' }),
			row(0, 'turn_start', { turnIndex: 0 }),
			row(1, 'provider_request'),
			row(1, 'message_end', {
				message: { type: 'object', keys: ['role', 'content'] },
			}),
			row(3, 'message_end', {
				message: {
					type: 'object',
					keys: ['role', 'content', 'usage', 'stopReason'],
				},
			}),
			row(4, 'turn_end', { turnIndex: 0 }),
			row(4, 'agent_end'),
			row(36_000, 'session_shutdown'),
		]);

		const model = timeline.runs[0]!.children[0]!.children[0]!;
		expect(model).toMatchObject({
			kind: 'model',
			open: false,
			end_ms: 3_000,
		});
	});

	it.each([
		'session_start',
		'session_shutdown',
		'agent_start',
		'agent_end',
		'turn_start',
		'branch_nav',
	])(
		'marks missing ends interrupted at %s without including the gap or later usage',
		(boundary) => {
			seq = 0;

			const timeline = build_timeline([
				row(0, 'agent_start', { prompt: 'Interrupted' }),
				row(0, 'turn_start', { turnIndex: 54 }),
				row(1, 'provider_request'),
				row(600, boundary),
				row(610, 'agent_start', { prompt: 'Resumed' }),
				row(610, 'turn_start', { turnIndex: 0 }),
				row(610, 'provider_request'),
				row(612, 'message_end', {
					message: {
						role: 'assistant',
						durationMs: 2000,
						usage: { input: 100, output: 20, cost: { total: 0.01 } },
					},
				}),
				row(613, 'turn_end'),
				row(613, 'agent_end'),
			]);

			const old_turn = timeline.runs[0]!.children[0]!;
			expect(old_turn).toMatchObject({
				open: false,
				interrupted: true,
				end_ms: 1000,
				duration_ms: 1000,
				input_tokens: null,
			});
			expect(old_turn.children[0]).toMatchObject({
				open: false,
				interrupted: true,
				end_ms: 1000,
				input_tokens: null,
				cost_usd: null,
			});
			const resumed = timeline.runs.at(-1)!.children[0]!.children[0]!;
			expect(resumed).toMatchObject({
				open: false,
				input_tokens: 100,
				cost_usd: 0.01,
			});
		},
	);

	it('ends spans without an end event where their parent ends', () => {
		seq = 0;

		const timeline = build_timeline([
			row(0, 'agent_start', { prompt: 'Crash' }),
			row(0, 'turn_start', { turnIndex: 0 }),
			row(1, 'tool_execution_start', {
				toolCallId: 'lost',
				toolName: 'bash',
			}),
			row(2, 'turn_end', { turnIndex: 0 }),
			row(2, 'agent_end'),
			row(3_600, 'session_shutdown'),
		]);

		const tool = timeline.runs[0]!.children[0]!.children[0]!;
		expect(tool).toMatchObject({
			kind: 'tool',
			open: true,
			end_ms: 2_000,
			duration_ms: 1_000,
		});
	});
});
