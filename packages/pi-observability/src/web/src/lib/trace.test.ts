import { describe, expect, it } from 'vite-plus/test';
import type { TimelineSpan } from '../../../types';
import {
	bar_position,
	failed_spans,
	find_span,
	run_of,
	trace_rows,
} from './trace.js';

function span(
	id: string,
	start_ms: number,
	end_ms: number,
	children: TimelineSpan[] = [],
	error = false,
): TimelineSpan {
	return {
		id,
		kind: id.startsWith('run')
			? 'run'
			: id.startsWith('turn')
				? 'turn'
				: 'tool',
		name: id,
		detail: null,
		start_ts: '2026-10-31T10:00:00.000Z',
		start_ms,
		end_ms,
		duration_ms: end_ms - start_ms,
		open: false,
		error,
		error_text: error ? 'boom' : null,
		exit_code: null,
		lane: 0,
		update_count: null,
		input_tokens: null,
		output_tokens: null,
		cache_read_tokens: null,
		cost_usd: null,
		event_seqs: [],
		children,
	};
}

const failing_tool = span('tool:b', 300, 400, [], true);
const run = span('run:1', 0, 1_000, [
	span('turn:1', 0, 500, [span('tool:a', 100, 200), failing_tool]),
	span('turn:2', 500, 1_000, [span('tool:c', 600, 700)]),
]);
const runs = [
	run,
	span('run:2', 2_000, 3_000, [span('turn:3', 2_000, 2_500)]),
];

describe('trace helpers', () => {
	it('lists rows depth first with depth', () => {
		expect(
			trace_rows(run).map((row) => [row.span.id, row.depth]),
		).toEqual([
			['turn:1', 0],
			['tool:a', 1],
			['tool:b', 1],
			['turn:2', 0],
			['tool:c', 1],
		]);
	});

	it('keeps only failures and the turns that hold them', () => {
		expect(trace_rows(run, true).map((row) => row.span.id)).toEqual([
			'turn:1',
			'tool:b',
		]);
	});

	it('finds failures, spans, and their runs', () => {
		expect(failed_spans(runs).map((item) => item.id)).toEqual([
			'tool:b',
		]);
		expect(find_span(runs, 'tool:c')?.start_ms).toBe(600);
		expect(run_of(runs, 'turn:3')?.id).toBe('run:2');
		expect(run_of(runs, 'tool:missing')).toBeNull();
	});

	it('positions bars as a share of the run', () => {
		expect(bar_position(failing_tool, run)).toEqual({
			left: 30,
			width: 10,
		});
		expect(bar_position(span('x', -50, 2_000), run)).toEqual({
			left: 0,
			width: 100,
		});
	});
});
