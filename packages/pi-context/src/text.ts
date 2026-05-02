import type {
	ContextChunk,
	ContextStoreOptions,
	StoredContextOutput,
} from './types.js';

export const DEFAULT_CONTEXT_MAX_BYTES = 24 * 1024;
export const DEFAULT_CONTEXT_MAX_LINES = 300;
const DEFAULT_PREVIEW_LINES = 80;
const DEFAULT_PREVIEW_BYTES = 8 * 1024;

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

	const tokens = trimmed
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean)
		.map((token) => {
			const is_prefix = token.endsWith('*');
			const base = is_prefix ? token.slice(0, -1) : token;
			const safe = base
				.replace(/["'(){}[\]^:./\\+-]/g, ' ')
				.trim()
				.replace(/\s+/g, ' ');
			if (!safe) return '';
			const quoted = `"${safe.replace(/"/g, '""')}"`;
			return is_prefix ? `${quoted}*` : quoted;
		})
		.filter(Boolean);

	return tokens.length > 0 ? tokens.join(' ') : '""';
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
	const paragraphs = text.split(/\n{2,}/);
	const chunks: string[] = [];
	let current = '';
	const target_bytes = 4096;

	for (const paragraph of paragraphs) {
		if (Buffer.byteLength(paragraph, 'utf8') > target_bytes) {
			if (current) chunks.push(current);
			chunks.push(...split_large_chunk(paragraph, target_bytes));
			current = '';
			continue;
		}

		const next = current ? `${current}\n\n${paragraph}` : paragraph;
		if (Buffer.byteLength(next, 'utf8') > target_bytes && current) {
			chunks.push(current);
			current = paragraph;
		} else {
			current = next;
		}
	}
	if (current) chunks.push(current);
	if (chunks.length === 0) chunks.push(text);

	return chunks.map((content, index) => ({
		id: `${source_id}_${String(index + 1).padStart(4, '0')}`,
		source_id,
		ordinal: index + 1,
		title: first_non_empty_line(content),
		content,
		byte_count: Buffer.byteLength(content, 'utf8'),
	}));
}

function split_large_chunk(
	text: string,
	target_bytes: number,
): string[] {
	const chunks: string[] = [];
	let current = '';

	for (const line of text.split('\n')) {
		const next = current ? `${current}\n${line}` : line;
		if (Buffer.byteLength(next, 'utf8') <= target_bytes) {
			current = next;
			continue;
		}

		if (current) chunks.push(current);
		if (Buffer.byteLength(line, 'utf8') <= target_bytes) {
			current = line;
			continue;
		}

		let rest = line;
		while (Buffer.byteLength(rest, 'utf8') > target_bytes) {
			const [head, tail] = split_utf8_at_byte(rest, target_bytes);
			chunks.push(head);
			rest = tail;
		}
		current = rest;
	}

	if (current) chunks.push(current);
	return chunks;
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
	return [
		result.deduped
			? `[context-sidecar] Duplicate large ${tool_name} output reused existing local index`
			: `[context-sidecar] Large ${tool_name} output indexed locally`,
		``,
		`Source: ${result.source_id}`,
		`Size: ${format_bytes(result.bytes)}, ${result.lines} lines, ${result.chunk_count} chunks`,
		`Use context_search query:"..." source_id:"${result.source_id}" to inspect it.`,
		`Use context_get source_id:"${result.source_id}" for exact chunks.`,
		``,
		result.preview,
	].join('\n');
}
