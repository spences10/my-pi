import type { DatabaseSync } from 'node:sqlite';
import type {
	SessionTimeline,
	TimelineSpan,
	TimelineSpanKind,
} from './types.js';

/** The events columns the timeline needs, one row per event. */
export interface TimelineEventRow {
	seq: number;
	ts: string;
	type: string;
	payload_json: string;
	model: string | null;
	tool_call_id: string | null;
	tool_name: string | null;
	is_error: number | null;
	duration_ms: number | null;
	stop_reason: string | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cost_usd: number | null;
	error_text: string | null;
	exit_code: number | null;
	parent_tool_call_id: string | null;
}

const PREVIEW_CHARS = 160;
const INPUT_PREVIEW_KEYS = [
	'command',
	'path',
	'file_path',
	'pattern',
	'query',
	'url',
	'action',
];

function parse_payload(json: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(json);
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function preview(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	const line = value.trim().replace(/\s+/g, ' ');
	return line.length > PREVIEW_CHARS
		? `${line.slice(0, PREVIEW_CHARS)}…`
		: line;
}

/**
 * Assistant messages end model calls. Events stored before message
 * summaries kept `role` only list the keys, and only assistant
 * messages have a stopReason.
 */
function is_assistant_message(message: unknown): boolean {
	if (!message || typeof message !== 'object') return false;
	const record = message as Record<string, unknown>;
	if (typeof record.role === 'string')
		return record.role === 'assistant';
	return (
		Array.isArray(record.keys) && record.keys.includes('stopReason')
	);
}

function input_preview(
	payload: Record<string, unknown>,
): string | null {
	const input = payload.input;
	if (!input || typeof input !== 'object') return null;
	const record = input as Record<string, unknown>;
	for (const key of INPUT_PREVIEW_KEYS) {
		const text = preview(record[key]);
		if (text) return text;
	}
	return null;
}

/**
 * Turns one session's events into nested spans: run (prompt to agent
 * end) > turn > model call and tool calls. Tool calls with a parent
 * call nest under it. Spans without an end event stay open and end at
 * the last event.
 */
export function build_timeline(
	rows: TimelineEventRow[],
): SessionTimeline {
	const first = rows[0];
	if (!first) return { start_ts: null, end_ms: 0, runs: [] };
	const origin = Date.parse(first.ts);
	const offset = (ts: string) => Math.max(0, Date.parse(ts) - origin);
	const end_ms = offset(rows[rows.length - 1]!.ts);

	const runs: TimelineSpan[] = [];
	const open_spans = new Set<TimelineSpan>();
	const tools = new Map<string, TimelineSpan>();
	let run: TimelineSpan | null = null;
	let turn: TimelineSpan | null = null;
	let model: TimelineSpan | null = null;
	let turns_in_run = 0;

	function open(
		kind: TimelineSpanKind,
		id: string,
		name: string,
		row: TimelineEventRow,
		parent: TimelineSpan | null,
	): TimelineSpan {
		const span: TimelineSpan = {
			id,
			kind,
			name,
			detail: null,
			start_ts: row.ts,
			start_ms: offset(row.ts),
			end_ms: offset(row.ts),
			duration_ms: 0,
			open: true,
			error: false,
			error_text: null,
			exit_code: null,
			lane: 0,
			update_count: null,
			input_tokens: null,
			output_tokens: null,
			cache_read_tokens: null,
			cost_usd: null,
			event_seqs: [row.seq],
			children: [],
		};
		if (parent) parent.children.push(span);
		else runs.push(span);
		open_spans.add(span);
		return span;
	}

	function close(span: TimelineSpan, row: TimelineEventRow): void {
		span.end_ms = offset(row.ts);
		span.duration_ms =
			row.duration_ms ?? Math.max(0, span.end_ms - span.start_ms);
		span.open = false;
		span.event_seqs.push(row.seq);
		open_spans.delete(span);
		clip_open_children(span);
	}

	// A child without an end event cannot outlive its parent: it ends
	// where the parent ends and stays marked open.
	function clip_open_children(parent: TimelineSpan): void {
		for (const child of parent.children) {
			if (open_spans.has(child)) {
				child.end_ms = parent.end_ms;
				child.duration_ms = Math.max(
					0,
					child.end_ms - child.start_ms,
				);
				open_spans.delete(child);
			}
			clip_open_children(child);
		}
	}

	// Events before the first prompt (session start, model select) and
	// turns without a prompt get a run of their own.
	function ensure_run(row: TimelineEventRow): TimelineSpan {
		if (run) return run;
		run = open('run', `run:${row.seq}`, 'Session', row, null);
		turns_in_run = 0;
		return run;
	}

	for (const row of rows) {
		const payload = parse_payload(row.payload_json);
		switch (row.type) {
			case 'agent_start': {
				if (run?.open) close(run, row);
				run = open(
					'run',
					`run:${row.seq}`,
					preview(payload.prompt) ?? 'Prompt',
					row,
					null,
				);
				turn = null;
				model = null;
				turns_in_run = 0;
				break;
			}
			case 'agent_end': {
				if (run?.open) close(run, row);
				run = null;
				turn = null;
				model = null;
				break;
			}
			case 'turn_start': {
				const parent = ensure_run(row);
				turns_in_run += 1;
				turn = open(
					'turn',
					`turn:${row.seq}`,
					`Turn ${turns_in_run}`,
					row,
					parent,
				);
				break;
			}
			case 'turn_end': {
				if (turn?.open) {
					close(turn, row);
					turn.duration_ms = Math.max(0, turn.end_ms - turn.start_ms);
				}
				turn = null;
				break;
			}
			case 'provider_request': {
				model = open(
					'model',
					`model:${row.seq}`,
					row.model ?? 'Model call',
					row,
					turn ?? ensure_run(row),
				);
				break;
			}
			case 'message_end': {
				const message = payload.message as
					| Record<string, unknown>
					| undefined;
				if (!is_assistant_message(message) || !model?.open) break;
				close(model, row);
				model.detail = row.stop_reason;
				model.error = row.stop_reason === 'error';
				model.error_text = row.error_text;
				model.input_tokens = row.input_tokens;
				model.output_tokens = row.output_tokens;
				model.cache_read_tokens = row.cache_read_tokens;
				model.cost_usd = row.cost_usd;
				model = null;
				break;
			}
			case 'tool_execution_start': {
				if (!row.tool_call_id) break;
				const parent =
					(row.parent_tool_call_id &&
						tools.get(row.parent_tool_call_id)) ||
					turn ||
					ensure_run(row);
				const span = open(
					'tool',
					`tool:${row.tool_call_id}`,
					row.tool_name ?? 'tool',
					row,
					parent,
				);
				span.detail = input_preview(payload);
				tools.set(row.tool_call_id, span);
				break;
			}
			case 'tool_call': {
				const span = row.tool_call_id && tools.get(row.tool_call_id);
				if (!span) break;
				span.detail ??= input_preview(payload);
				span.event_seqs.push(row.seq);
				break;
			}
			case 'tool_result':
			case 'tool_execution_end': {
				const span = row.tool_call_id && tools.get(row.tool_call_id);
				if (!span) break;
				if (row.type === 'tool_execution_end' && span.open)
					close(span, row);
				else span.event_seqs.push(row.seq);
				span.error ||= row.is_error === 1;
				span.error_text ??= row.error_text;
				span.exit_code ??= row.exit_code;
				if (row.type === 'tool_execution_end') {
					const updates = payload.updateCount;
					span.update_count =
						typeof updates === 'number' ? updates : null;
				}
				break;
			}
		}
	}

	for (const span of open_spans) {
		span.end_ms = end_ms;
		span.duration_ms = Math.max(0, end_ms - span.start_ms);
	}
	for (const span of runs) assign_lanes(span);
	return { start_ts: first.ts, end_ms, runs };
}

/** Puts overlapping tool calls under one parent on separate rows. */
function assign_lanes(span: TimelineSpan): void {
	const lane_ends: number[] = [];
	const tool_children = span.children
		.filter((child) => child.kind === 'tool')
		.sort((a, b) => a.start_ms - b.start_ms);
	for (const tool of tool_children) {
		let lane = lane_ends.findIndex((end) => end <= tool.start_ms);
		if (lane === -1) lane = lane_ends.length;
		lane_ends[lane] = tool.end_ms;
		tool.lane = lane;
	}
	for (const child of span.children) assign_lanes(child);
}

export function create_timeline_query(db: DatabaseSync) {
	const statement = db.prepare(`
		SELECT seq, ts, type, payload_json, model, tool_call_id, tool_name,
			is_error, duration_ms, stop_reason, input_tokens, output_tokens,
			cache_read_tokens, cost_usd, error_text, exit_code,
			parent_tool_call_id
		FROM events
		WHERE session_id = $session_id
		ORDER BY seq
	`);
	return (session_id: string): SessionTimeline =>
		build_timeline(
			statement.all({ session_id }) as unknown as TimelineEventRow[],
		);
}
