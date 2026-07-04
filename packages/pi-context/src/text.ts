import type {
	ContextChunk,
	ContextStoreOptions,
	StoredContextOutput,
} from './types.js';

export const DEFAULT_CONTEXT_MAX_BYTES = 24 * 1024;
export const DEFAULT_CONTEXT_MAX_LINES = 300;
const DEFAULT_PREVIEW_LINES = 40;
const DEFAULT_PREVIEW_BYTES = 4 * 1024;

export function count_lines(text: string): number {
	if (!text) return 0;
	return text.split('\n').length;
}

export function should_index_text(
	text: string,
	options: Pick<ContextStoreOptions, 'max_bytes' | 'max_lines'> = {},
): boolean {
	const max_bytes = options.max_bytes ?? DEFAULT_CONTEXT_MAX_BYTES;
	const max_lines = options.max_lines ?? DEFAULT_CONTEXT_MAX_LINES;
	return (
		Buffer.byteLength(text, 'utf8') > max_bytes ||
		count_lines(text) > max_lines
	);
}

export function escape_fts5_query(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return '""';
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.replace(
			/"(.*)"/s,
			(_match, inner: string) => `"${inner.replace(/"/g, '""')}"`,
		);
	}

	const tokens = normalized_fts_tokens(trimmed).map(format_fts_token);
	return tokens.length > 0 ? tokens.join(' ') : '""';
}

export function relaxed_fts5_query(query: string): string | null {
	const normalized = normalized_fts_tokens(query);
	if (normalized.length < 2) return null;
	const tokens = normalized
		.flatMap((token) =>
			token.value.split(/\s+/).map((value) => ({
				value,
				prefix: token.prefix,
			})),
		)
		.filter((token) => token.value.length > 1)
		.filter(
			(token) =>
				!new Set([
					'and',
					'or',
					'not',
					'the',
					'this',
					'that',
					'with',
					'from',
					'into',
					'specific',
					'chunk',
					'line',
				]).has(token.value.toLowerCase()),
		)
		.slice(0, 12)
		.map(format_fts_token);

	if (tokens.length === 0) return null;
	return tokens.join(' OR ');
}

function normalized_fts_tokens(
	query: string,
): Array<{ value: string; prefix: boolean }> {
	return query
		.trim()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean)
		.map((token) => {
			const prefix = token.endsWith('*');
			const base = prefix ? token.slice(0, -1) : token;
			return {
				prefix,
				value: base
					.replace(/["'(){}[\]^:./\\+-]/g, ' ')
					.trim()
					.replace(/\s+/g, ' '),
			};
		})
		.filter((token) => token.value.length > 0);
}

function format_fts_token(token: {
	value: string;
	prefix: boolean;
}): string {
	const quoted = `"${token.value.replace(/"/g, '""')}"`;
	return token.prefix ? `${quoted}*` : quoted;
}

export function make_preview(
	text: string,
	max_lines = DEFAULT_PREVIEW_LINES,
	max_bytes = DEFAULT_PREVIEW_BYTES,
): string {
	const lines = text.split('\n');
	let preview: string;
	if (lines.length <= max_lines) {
		preview = text;
	} else {
		const head_count = Math.ceil(max_lines / 2);
		const tail_count = Math.floor(max_lines / 2);
		const omitted = lines.length - head_count - tail_count;
		preview = [
			...lines.slice(0, head_count),
			``,
			`[... ${omitted} lines omitted; indexed in context sidecar ...]`,
			``,
			...lines.slice(-tail_count),
		].join('\n');
	}

	return take_utf8_bytes(preview, max_bytes);
}

function take_utf8_bytes(text: string, max_bytes: number): string {
	if (Buffer.byteLength(text, 'utf8') <= max_bytes) return text;
	let bytes = 0;
	let output = '';
	for (const char of text) {
		const char_bytes = Buffer.byteLength(char, 'utf8');
		if (bytes + char_bytes > max_bytes) break;
		bytes += char_bytes;
		output += char;
	}
	return `${output}\n[... preview truncated at ${format_bytes(max_bytes)} ...]`;
}

export function chunk_text(
	text: string,
	source_id: string,
): ContextChunk[] {
	const target_bytes = 4096;
	const chunks = split_lossless_chunks(text, target_bytes);

	return chunks.map((content, index) => ({
		id: `${source_id}_${String(index + 1).padStart(4, '0')}`,
		source_id,
		ordinal: index + 1,
		title: first_non_empty_line(content),
		content,
		byte_count: Buffer.byteLength(content, 'utf8'),
	}));
}

function split_lossless_chunks(
	text: string,
	target_bytes: number,
): string[] {
	const chunks: string[] = [];
	let rest = text;

	while (Buffer.byteLength(rest, 'utf8') > target_bytes) {
		const [head, tail] = split_utf8_at_byte(rest, target_bytes);
		const break_index = preferred_break_index(head);
		if (break_index === null) {
			chunks.push(head);
			rest = tail;
			continue;
		}

		chunks.push(rest.slice(0, break_index));
		rest = rest.slice(break_index);
	}

	if (rest || chunks.length === 0) chunks.push(rest);
	return chunks;
}

function preferred_break_index(head: string): number | null {
	const minimum = Math.floor(head.length * 0.6);
	for (const index of [
		last_paragraph_break_index(head),
		head.lastIndexOf('\n') + 1,
		head.lastIndexOf(' ') + 1,
		head.lastIndexOf('\t') + 1,
	]) {
		if (index >= minimum) return index;
	}
	return null;
}

function last_paragraph_break_index(text: string): number {
	let index = 0;
	for (const match of text.matchAll(/\n{2,}/g))
		index = match.index + match[0].length;
	return index;
}

function split_utf8_at_byte(
	text: string,
	max_bytes: number,
): [string, string] {
	let bytes = 0;
	let index = 0;
	for (const char of text) {
		const char_bytes = Buffer.byteLength(char, 'utf8');
		if (bytes + char_bytes > max_bytes) break;
		bytes += char_bytes;
		index += char.length;
	}
	return [text.slice(0, index), text.slice(index)];
}

function first_non_empty_line(text: string): string | null {
	const line = text
		.split('\n')
		.map((value) => value.trim())
		.find(Boolean);
	return line ? line.slice(0, 120) : null;
}

export function format_bytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function summarize_source(
	result: StoredContextOutput,
	tool_name: string,
): string {
	const capture_reason = format_capture_reason(result);
	return [
		result.deduped
			? `[context-sidecar] Duplicate large ${tool_name} output reused existing local index`
			: `[context-sidecar] Large ${tool_name} output indexed locally`,
		``,
		`Source: ${result.source_id}`,
		`Size: ${format_bytes(result.bytes)}, ${result.lines} lines, ${result.chunk_count} chunks`,
		capture_reason,
		result.first_chunk_id
			? `First chunk id: ${result.first_chunk_id}`
			: undefined,
		`Project: ${result.project_path ?? '(none)'}`,
		`Session: ${result.session_id ?? '(none)'}`,
		``,
		`Next actions:`,
		`- Search concise snippets first: context_search query:"..." source_id:"${result.source_id}"`,
		`- Need surrounding context? context_get source_id:"${result.source_id}" chunk_id:"${result.first_chunk_id ?? '1'}" before:1 after:1 (before/after max 3)`,
		`- Need broad/full JSON/log/script processing? context_export source_id:"${result.source_id}" then use rg/jq/Python on the file`,
		`- Avoid full context_get without chunk_id unless you truly need all chunks in chat`,
		`- List recent scoped sources: context_list`,
		``,
		`Preview:`,
		result.preview,
	]
		.filter((line): line is string => line !== undefined)
		.join('\n');
}

function format_capture_reason(
	result: StoredContextOutput,
): string | undefined {
	if (
		result.capture_max_bytes === undefined ||
		result.capture_max_lines === undefined
	)
		return undefined;

	const reasons: string[] = [];
	if (result.bytes > result.capture_max_bytes) {
		reasons.push(
			`${format_bytes(result.bytes)} exceeds ${format_bytes(result.capture_max_bytes)}`,
		);
	}
	if (result.lines > result.capture_max_lines) {
		reasons.push(
			`${result.lines} lines exceeds ${result.capture_max_lines}`,
		);
	}
	if (reasons.length === 0) {
		reasons.push(
			`forced capture; thresholds are ${format_bytes(result.capture_max_bytes)} or ${result.capture_max_lines} lines`,
		);
	}
	return `Captured: ${reasons.join('; ')}.`;
}
