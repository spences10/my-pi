import type { TimelineSpan } from '../../../types';

export interface TraceRow {
	span: TimelineSpan;
	depth: number;
}

/** True when the span or anything under it failed. */
export function contains_failure(span: TimelineSpan): boolean {
	return span.error || span.children.some(contains_failure);
}

/** Failed spans in the order they appear on screen. */
export function failed_spans(spans: TimelineSpan[]): TimelineSpan[] {
	return spans.flatMap((span) => [
		...(span.error ? [span] : []),
		...failed_spans(span.children),
	]);
}

/**
 * The rows under one run, depth first. With `failures_only`, keeps a
 * span only when it or a descendant failed, so each failure keeps the
 * turn it happened in.
 */
export function trace_rows(
	run: TimelineSpan,
	failures_only = false,
): TraceRow[] {
	const rows: TraceRow[] = [];
	const visit = (span: TimelineSpan, depth: number) => {
		if (failures_only && !contains_failure(span)) return;
		rows.push({ span, depth });
		for (const child of span.children) visit(child, depth + 1);
	};
	for (const child of run.children) visit(child, 0);
	return rows;
}

/** The run that contains a span id, if any. */
export function run_of(
	runs: TimelineSpan[],
	span_id: string,
): TimelineSpan | null {
	const has = (span: TimelineSpan): boolean =>
		span.id === span_id || span.children.some(has);
	return runs.find(has) ?? null;
}

export function find_span(
	spans: TimelineSpan[],
	span_id: string,
): TimelineSpan | null {
	for (const span of spans) {
		if (span.id === span_id) return span;
		const found = find_span(span.children, span_id);
		if (found) return found;
	}
	return null;
}

/** Bar position inside a run, as percentages of the run's length. */
export function bar_position(
	span: TimelineSpan,
	run: TimelineSpan,
): { left: number; width: number } {
	const length = Math.max(1, run.end_ms - run.start_ms);
	const left = ((span.start_ms - run.start_ms) / length) * 100;
	const width = ((span.end_ms - span.start_ms) / length) * 100;
	return {
		left: Math.min(100, Math.max(0, left)),
		width: Math.min(100 - Math.max(0, left), Math.max(0, width)),
	};
}
