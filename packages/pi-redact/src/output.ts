import type {
	ImageContent,
	TextContent,
	ThinkingContent,
	ToolCall,
} from '@earendil-works/pi-ai';
import type {
	BashOperations,
	ContextEvent,
	ExtensionHandler,
	SessionEntry,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import * as v from 'valibot';
import {
	classify_private_key_line,
	find_redaction_spans,
	is_redaction_marker,
	known_value_forms,
	looks_like_ssh_config,
	merge_redaction_spans,
	redact_text,
	type RedactionOptions,
	type RedactionSpan,
} from './redaction.js';

type AgentMessage = ContextEvent['messages'][number];

type ContentBlock =
	| TextContent
	| ImageContent
	| ThinkingContent
	| ToolCall;

type TextRedactor = (
	text: string,
	options?: RedactionOptions,
) => string;

const string_schema = v.string();
const object_schema = v.record(v.string(), v.unknown());

const text_schema = v.object({
	type: v.literal('text'),
	text: v.string(),
});

const binary_schema = v.union([
	v.object({
		type: v.picklist(['image', 'audio', 'image_url', 'input_audio']),
	}),
	v.object({ mimeType: v.string(), data: v.string() }),
	v.object({ mimeType: v.string(), blob: v.string() }),
]);

/** Content-keyed, bounded memoization survives the SDK's deep context clones. */
export function create_redactor() {
	let known_values: string[] = [];
	let total = 0;
	let cached_bytes = 0;
	const cache = new Map<string, string>();
	const max_cache_bytes = 1024 * 1024;

	function clear_cache() {
		cache.clear();
		cached_bytes = 0;
	}

	const text: TextRedactor = (input, options) => {
		if (!input) return input;

		const key = createHash('sha256')
			.update(
				`${Boolean(options?.force_private_key)}:${Boolean(options?.force_ssh_config)}:`,
			)
			.update(input)
			.digest('hex');

		const cached = cache.get(key);

		if (cached !== undefined) return cached;

		const result = redact_text(input, { ...options, known_values });
		total += result.count;
		const bytes = Buffer.byteLength(result.redacted);

		if (bytes <= max_cache_bytes) {
			while (
				cache.size >= 512 ||
				cached_bytes + bytes > max_cache_bytes
			) {
				const oldest = cache.keys().next().value;

				if (oldest === undefined) break;

				cached_bytes -= Buffer.byteLength(cache.get(oldest) ?? '');
				cache.delete(oldest);
			}

			cache.set(key, result.redacted);
			cached_bytes += bytes;
		}

		return result.redacted;
	};

	return {
		text,
		get total() {
			return total;
		},
		get known_values(): readonly string[] {
			return known_values;
		},
		register(values: readonly string[]) {
			known_values = [
				...new Set([...known_values, ...values]),
			].filter((value) => value.length > 0);
			clear_cache();
		},
		clear() {
			known_values = [];
			total = 0;
			clear_cache();
		},
	};
}

/** Preserve non-JSON objects and binary payloads; only clone textual data leaves. */
export function redact_data<T>(
	value: T,
	redact: TextRedactor,
	seen = new WeakMap<object, object>(),
): T {
	if (v.is(string_schema, value)) {
		// SAFETY: replacing a string leaf preserves this data's structural type.
		return redact(value) as T;
	}

	if (v.is(object_schema, value) || Array.isArray(value)) {
		const previous = seen.get(value);

		if (previous) {
			// SAFETY: a previous clone has the same shape as this exact source object.
			return previous as T;
		}
	}

	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(value, result);

		for (let index = 0; index < value.length; index++) {
			const item = value[index];

			if (v.is(text_schema, item)) {
				let combined = item.text;
				let end = index + 1;

				while (end < value.length && v.is(text_schema, value[end])) {
					combined += value[end].text;
					end++;
				}

				const redacted = redact(combined);
				const first = redact_data(item, redact, seen);
				first.text = redacted === combined ? item.text : redacted;
				result.push(first);

				// Retain clean block attribution and metadata; clear only masked fragments.
				for (let next = index + 1; next < end; next++) {
					const block = redact_data(value[next], redact, seen);
					block.text = redacted === combined ? value[next].text : '';
					result.push(block);
				}

				index = end - 1;
			} else {
				result.push(redact_data(item, redact, seen));
			}
		}

		// SAFETY: array shape and element types are preserved; only string leaves change.
		return result as T;
	}

	if (!v.is(object_schema, value)) return value;

	if (
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	)
		return value;

	const result = v.parse(object_schema, value);
	seen.set(value, result);
	const binary = v.is(binary_schema, value);

	for (const [key, item] of Object.entries(value)) {
		if (binary && ['data', 'blob', 'mimeType', 'type'].includes(key))
			continue;

		if (
			[
				'textSignature',
				'thinkingSignature',
				'thoughtSignature',
			].includes(key)
		)
			continue;

		if (
			key === 'url' &&
			v.is(string_schema, item) &&
			/^data:[^;]+;base64,/.test(item)
		)
			continue;

		if (v.is(string_schema, item)) {
			const direct = redact(item);
			const serialized = JSON.stringify({ [key]: direct });
			const wrapped = redact(serialized);

			if (wrapped === serialized) {
				result[key] = direct;
				continue;
			}

			// Field matching supplies context, but regex replacement need not retain JSON syntax.
			try {
				const parsed = v.parse(
					v.record(v.string(), v.string()),
					JSON.parse(wrapped),
				);

				result[key] =
					Object.values(parsed)[0] ?? '[REDACTED:Secret Field]';
			} catch {
				result[key] = '[REDACTED:Secret Field]';
			}
		} else {
			result[key] = redact_data(item, redact, seen);
		}
	}

	// SAFETY: this clone preserves all keys and non-string values of the validated plain object.
	return result as T;
}

/** Never rewrite execution arguments, opaque signatures, IDs or role metadata. */
export function redact_message(
	message: AgentMessage,
	redact: TextRedactor,
	request_copy = false,
): AgentMessage {
	switch (message.role) {
		case 'bashExecution':
			return {
				...message,
				command: redact(message.command),
				output: redact(message.output),
			};
		case 'branchSummary':
		case 'compactionSummary':
			return { ...message, summary: redact(message.summary) };
		case 'system':
			return {
				...message,
				content: redact_text_blocks(message.content, redact),
				sections: redact_data(message.sections, redact),
			};
		case 'assistant': {
			const content = message.content.map((block) => {
				if (block.type === 'toolCall') {
					return request_copy
						? {
								...block,
								arguments: redact_data(block.arguments, redact),
							}
						: block;
				}

				if (block.type === 'thinking')
					return { ...block, thinking: redact(block.thinking) };

				return block;
			});

			return {
				...message,
				content: redact_text_blocks(content, redact),
				errorMessage:
					message.errorMessage && redact(message.errorMessage),
			};
		}

		case 'toolResult':
			return {
				...message,
				content: redact_text_blocks(message.content, redact),
				details: redact_data(message.details, redact),
			};
		case 'custom':
			return {
				...message,
				content: redact_text_blocks(message.content, redact),
				details: redact_data(message.details, redact),
			};
		case 'user':
			return {
				...message,
				content: redact_text_blocks(message.content, redact),
			};
	}
}

export function redact_text_blocks<T extends string | ContentBlock[]>(
	content: T,
	redact: TextRedactor,
): T {
	if (!Array.isArray(content)) {
		// SAFETY: a string remains a string; only its text changes.
		return redact(content) as T;
	}

	const result = content.slice();

	for (let index = 0; index < content.length; index++) {
		const first = content[index];

		if (first.type !== 'text') continue;

		let combined = first.text;
		let end = index + 1;

		while (end < content.length) {
			const next = content[end];

			if (next.type !== 'text') break;

			combined += next.text;
			end++;
		}

		const redacted = redact(combined);

		if (redacted === combined) {
			index = end - 1;
			continue;
		}

		result[index] = { ...first, text: redacted };

		for (let next = index + 1; next < end; next++) {
			const block = content[next];

			if (block.type === 'text')
				result[next] = { ...block, text: '' };
		}

		index = end - 1;
	}

	// SAFETY: the block order, discriminants and metadata are unchanged.
	return result as T;
}

/** Replace array elements, not the array: SDK tree navigation retains its reference. */
export function redact_entries(
	entries: SessionEntry[],
	redact: TextRedactor,
) {
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];

		switch (entry.type) {
			case 'message':
				entries[index] = {
					...entry,
					message: redact_message(entry.message, redact, true),
				};
				break;
			case 'compaction':
			case 'branch_summary':
				entries[index] = {
					...entry,
					summary: redact(entry.summary),
					details: redact_data(entry.details, redact),
				};
				break;
			case 'custom_message':
				entries[index] = {
					...entry,
					content: redact_text_blocks(entry.content, redact),
					details: redact_data(entry.details, redact),
				};
				break;
			case 'context_edit':
				entries[index] = {
					...entry,
					replacement: entry.replacement && {
						...entry.replacement,
						content: redact_text_blocks(
							entry.replacement.content,
							redact,
						),
					},
				};
				break;
		}
	}
}

type TerminalState =
	| 'text'
	| 'escape'
	| 'intermediate'
	| 'csi'
	| 'string'
	| 'string_escape';

/** Consume terminal controls incrementally, including arbitrarily split CSI/OSC. */
function create_terminal_filter() {
	let state: TerminalState = 'text';

	return (text: string): string => {
		const output: string[] = [];

		for (const character of text) {
			const code = character.charCodeAt(0);

			if (state === 'string' || state === 'string_escape') {
				if (
					code === 7 ||
					code === 0x9c ||
					(state === 'string_escape' && character === '\\')
				)
					state = 'text';
				else state = code === 27 ? 'string_escape' : 'string';
				continue;
			}

			if (code === 27) {
				state = 'escape';
				continue;
			}

			if (code === 0x9b) {
				state = 'csi';
				continue;
			}

			if (code === 0x9d) {
				state = 'string';
				continue;
			}

			if (state === 'escape') {
				if (character === '[') {
					state = 'csi';
					continue;
				}

				if (']PX^_'.includes(character)) {
					state = 'string';
					continue;
				}

				if (code >= 0x20 && code <= 0x2f) {
					state = 'intermediate';
					continue;
				}

				state = 'text';

				if (code >= 0x30 && code <= 0x7e) continue;
			} else if (state === 'intermediate') {
				if (code >= 0x20 && code <= 0x2f) continue;
				state = 'text';

				if (code >= 0x30 && code <= 0x7e) continue;
			} else if (state === 'csi') {
				if (code >= 0x20 && code <= 0x3f) continue;
				state = 'text';

				if (code >= 0x40 && code <= 0x7e) continue;
			}

			// Match Pi's later binary-output/CR deletion before looking for secrets.
			if (
				(code < 32 && code !== 9 && code !== 10) ||
				(code >= 0xfff9 && code <= 0xfffb)
			)
				continue;
			output.push(character);
		}

		return output.join('');
	};
}

interface ExactPrefix {
	symbols: string;
	fallback: number[];
	matched: number;
}

function exact_prefix(source: string): ExactPrefix {
	const symbols = create_terminal_filter()(source);
	const fallback = Array.from({ length: symbols.length }, () => 0);

	for (let index = 1, matched = 0; index < symbols.length; index++) {
		while (matched && symbols[index] !== symbols[matched])
			matched = fallback[matched - 1];

		if (symbols[index] === symbols[matched]) matched++;
		fallback[index] = matched;
	}

	return { symbols, fallback, matched: 0 };
}

interface StreamLine {
	raw: string;
	spans: RedactionSpan[];
}

interface QueuedLine {
	raw: string;
	start: number;
	end: number;
}

/** Only syntactically plausible SSH directives require delayed contextual proof. */
function ssh_metadata_candidate(text: string) {
	const single =
		/^[ \t]*(?:HostName|User|IdentityFile|CertificateFile|ProxyJump|DynamicForward|HostKeyAlias)[ \t]+([^\r\n]+)/i.exec(
			text,
		);

	if (
		single &&
		!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)(?:[ \t]+#.*)?[ \t]*$/.test(
			single[1],
		)
	)
		return false;

	return looks_like_ssh_config('Host *\n' + text);
}

/** Retain raw evidence, union original-text spans, and render only finalized lines. */
function create_stream_filter(
	redact: TextRedactor,
	get_values: () => readonly string[],
	emit: (text: string) => void,
) {
	let values: readonly string[] | undefined;
	let patterns = new Map<string, ExactPrefix>();
	let position = 0;
	let line_start = 0;
	let line_parts: string[] = [];
	let queued: QueuedLine[] = [];
	let queue_head = 0;
	let exact_spans: RedactionSpan[] = [];
	let canonical: Array<{ start: number; end: number }> = [];
	let pem_pending: StreamLine[] = [];
	let pem_active = false;
	let pem_tail: StreamLine | undefined;
	let ssh_pending: StreamLine[] = [];
	let ssh_host = false;
	let ssh_metadata = false;
	let ssh_active = false;

	function render(
		line: StreamLine,
		options: RedactionOptions = {},
		extra: RedactionSpan[] = [],
	) {
		const ordinary = redact(line.raw, options);

		if (!line.spans.length && !extra.length) {
			emit(ordinary);

			return;
		}

		const spans = merge_redaction_spans([
			...find_redaction_spans(line.raw, {
				...options,
				known_values: get_values(),
			}),
			...line.spans,
			...extra,
		]);

		const pieces: string[] = [];
		let cursor = 0;

		for (const span of spans) {
			pieces.push(
				line.raw.slice(cursor, span.start),
				'[REDACTED:' + span.label + ']',
			);
			cursor = span.end;
		}

		pieces.push(line.raw.slice(cursor));
		const text = pieces.join('');
		emit(
			text +
				(line.raw.endsWith('\n') && !text.endsWith('\n') ? '\n' : ''),
		);
	}

	function mask_key(
		line: StreamLine,
		label = 'Private Key continuation',
		start = 0,
	) {
		render(
			line,
			{ force_private_key: true, force_ssh_config: ssh_active },
			[{ start, end: line.raw.trimEnd().length, label }],
		);
	}

	function flush_tail() {
		if (!pem_tail) return;

		if (
			pem_tail.raw.trimEnd().endsWith('=') ||
			!pem_tail.raw.endsWith('\n')
		)
			mask_key(pem_tail);
		else render(pem_tail, { force_ssh_config: ssh_active });
		pem_tail = undefined;
	}

	function pem_line(line: StreamLine) {
		const kind = classify_private_key_line(line.raw);

		if (pem_tail) {
			if (kind === 'end') {
				mask_key(pem_tail);
				render(line, {
					force_private_key: true,
					force_ssh_config: ssh_active,
				});
				pem_tail = undefined;
				pem_active = false;

				return;
			}

			flush_tail();
			pem_active = false;
		}

		if (
			pem_pending.length &&
			classify_private_key_line(
				pem_pending[pem_pending.length - 1].raw,
			) === 'short_body' &&
			kind !== 'end'
		) {
			for (const pending of pem_pending)
				render(pending, { force_ssh_config: ssh_active });
			pem_pending = [];
		}

		if (pem_pending.length) {
			if (kind === 'body' || kind === 'end') {
				for (const pending of pem_pending) {
					const header = pending.raw.lastIndexOf('-----BEGIN ');

					if (classify_private_key_line(pending.raw) === 'blank')
						render(pending);
					else mask_key(pending, 'Private Key', Math.max(0, header));
				}

				mask_key(line);
				pem_pending = [];
				pem_active = kind !== 'end';

				return;
			}

			if (
				kind === 'blank' ||
				kind === 'metadata' ||
				kind === 'short_body'
			) {
				pem_pending.push(line);

				return;
			}

			for (const pending of pem_pending)
				render(pending, { force_ssh_config: ssh_active });
			pem_pending = [];
		}

		if (pem_active) {
			if (kind === 'body' || kind === 'metadata') {
				mask_key(line);

				return;
			}

			if (kind === 'end') {
				render(line, {
					force_private_key: true,
					force_ssh_config: ssh_active,
				});
				pem_active = false;

				return;
			}

			if (kind === 'short_body') {
				pem_tail = line;

				return;
			}

			if (kind === 'blank') {
				render(line);

				return;
			}

			pem_active = false;
		}

		if (kind === 'header') {
			pem_pending.push(line);

			return;
		}

		render(line, { force_ssh_config: ssh_active });
	}

	function accept_line(line: StreamLine) {
		if (ssh_active) {
			pem_line(line);

			return;
		}

		const host = /^[ \t]*(?:Host|Match)[ \t]+\S/i.test(line.raw);
		const metadata = ssh_metadata_candidate(line.raw);

		if (!ssh_pending.length && !host && !metadata) {
			pem_line(line);

			return;
		}

		ssh_pending.push(line);
		ssh_host ||= host;
		ssh_metadata ||= metadata;

		if (ssh_host && ssh_metadata) {
			ssh_active = true;

			for (const pending of ssh_pending) pem_line(pending);
			ssh_pending = [];
		}
	}

	function enqueue(raw: string, end: number) {
		queued.push({ raw, start: line_start, end });

		for (const match of raw.matchAll(/\[REDACTED:[^\]\r\n]*\]/g)) {
			if (is_redaction_marker(match[0]))
				canonical.push({
					start: line_start + match.index,
					end: line_start + match.index + match[0].length,
				});
		}

		line_start = end;
	}

	function marker_at(position: number) {
		let low = 0;
		let high = canonical.length - 1;
		let preceding = -1;

		while (low <= high) {
			const middle = (low + high) >>> 1;

			if (canonical[middle].start <= position) {
				preceding = middle;
				low = middle + 1;
			} else high = middle - 1;
		}

		if (preceding < 0) return undefined;

		const marker = canonical[preceding];

		return position < marker.end ? marker : undefined;
	}

	function flush(boundary: number) {
		let end = queue_head;

		while (end < queued.length && queued[end].end <= boundary) end++;

		if (end === queue_head) return;

		const protected_spans: RedactionSpan[] = [];

		for (const span of exact_spans) {
			const first = marker_at(span.start);
			const last = marker_at(span.end - 1);

			if (first && span.end <= first.end) continue;

			// Same canonical policy as batch matching: contained hits are inert;
			// crossing matches consume the whole marker rather than corrupt it.
			protected_spans.push({
				start: first?.start ?? span.start,
				end: last?.end ?? span.end,
				label: span.label,
			});
		}

		exact_spans = protected_spans;
		const spans = merge_redaction_spans(exact_spans);
		let span_index = 0;

		for (; queue_head < end; queue_head++) {
			const line = queued[queue_head];
			const clipped: RedactionSpan[] = [];

			while (
				span_index < spans.length &&
				spans[span_index].end <= line.start
			)
				span_index++;

			for (
				let index = span_index;
				index < spans.length && spans[index].start < line.end;
				index++
			) {
				clipped.push({
					start:
						Math.max(spans[index].start, line.start) - line.start,
					end: Math.min(spans[index].end, line.end) - line.start,
					label: spans[index].label,
				});
			}

			accept_line({ raw: line.raw, spans: clipped });
		}

		const emitted = queued[end - 1].end;
		exact_spans = exact_spans.filter((span) => span.end > emitted);
		canonical = canonical.filter((marker) => marker.end > emitted);

		if (queue_head * 2 >= queued.length) {
			queued = queued.slice(queue_head);
			queue_head = 0;
		}
	}

	return {
		write(text: string) {
			const current = get_values();

			if (current !== values) {
				const next = new Map<string, ExactPrefix>();

				for (const form of known_value_forms(current)) {
					const pattern = patterns.get(form) ?? exact_prefix(form);

					if (pattern.symbols.length) next.set(form, pattern);
				}

				patterns = next;
				values = current;
			}

			let start = 0;

			// UTF-16 offsets match RegExp span offsets; line emission never splits Unicode.
			for (let index = 0; index < text.length; index++) {
				const character = text[index];

				for (const pattern of patterns.values()) {
					while (
						pattern.matched &&
						character !== pattern.symbols[pattern.matched]
					)
						pattern.matched = pattern.fallback[pattern.matched - 1];

					if (character === pattern.symbols[pattern.matched])
						pattern.matched++;

					if (pattern.matched === pattern.symbols.length) {
						exact_spans.push({
							start: position + index + 1 - pattern.symbols.length,
							end: position + index + 1,
							label: 'Known Secret',
						});
						pattern.matched = pattern.fallback[pattern.matched - 1];
					}
				}

				if (character === '\n') {
					line_parts.push(text.slice(start, index + 1));
					enqueue(line_parts.join(''), position + index + 1);
					line_parts = [];
					start = index + 1;
				}
			}

			if (start < text.length) line_parts.push(text.slice(start));
			position += text.length;
			let longest = 0;

			for (const pattern of patterns.values())
				longest = Math.max(longest, pattern.matched);
			flush(position - longest);
		},
		end() {
			if (line_parts.length) enqueue(line_parts.join(''), position);
			flush(Number.POSITIVE_INFINITY);

			for (const pending of ssh_pending) pem_line(pending);

			for (const pending of pem_pending)
				render(pending, { force_ssh_config: ssh_active });
			flush_tail();
		},
	};
}

const no_known_values: readonly string[] = [];

/** Sanitize before Pi streams, truncates or spools. Keep only undecided text. */
export function redacting_bash_operations(
	local: BashOperations,
	redact: TextRedactor,
	get_known_values: () => readonly string[] = () => no_known_values,
): BashOperations {
	return {
		async exec(command, cwd, options) {
			const decoder = new TextDecoder();
			const normalize = create_terminal_filter();
			const outgoing: string[] = [];

			function flush_output() {
				if (!outgoing.length) return;

				const text = outgoing.join('');
				outgoing.length = 0;
				options.onData(Buffer.from(text));
			}

			const stream = create_stream_filter(
				redact,
				get_known_values,
				(text) => {
					if (text) outgoing.push(text);
				},
			);

			try {
				return await local.exec(command, cwd, {
					...options,
					onData: (chunk) => {
						stream.write(
							normalize(decoder.decode(chunk, { stream: true })),
						);
						flush_output();
					},
				});
			} catch (error) {
				if (error instanceof Error) {
					error.message = redact(error.message);

					if (error.stack) error.stack = redact(error.stack);
				}

				throw redact_data(error, redact);
			} finally {
				stream.write(normalize(decoder.decode()));
				stream.end();
				flush_output();
			}
		},
	};
}

const read_schema = v.object({
	path: v.string(),
	offset: v.optional(v.number()),
});

const write_schema = v.object({
	path: v.string(),
	content: v.string(),
});

const key_source =
	/^\uFEFF?-----BEGIN[ \t]+[\w -]*PRIVATE[ \t]+KEY-----\r?\n(?:Proc-Type:[^\n]*\n|DEK-Info:[^\n]*\n|\r?\n)*[A-Za-z0-9+/=]{16,}/;

const marker = /\[REDACTED:[^\]\r\n]+\]/g;

async function canonical_path(path: string, cwd: string) {
	const absolute = resolve(
		cwd,
		path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path,
	);

	return realpath(absolute).catch(() => absolute);
}

async function is_private_key_source(path: string) {
	const file = await open(path, 'r').catch(() => undefined);

	if (!file) return false;

	try {
		if (!(await file.stat()).isFile()) return false;

		const bytes = Buffer.alloc(2048);
		const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);

		return key_source.test(
			bytes.subarray(0, bytesRead).toString('utf8'),
		);
	} catch {
		return false;
	} finally {
		await file.close();
	}
}

export function create_output_filter(redact_output: TextRedactor) {
	const masked_reads = new Map<string, Set<string>>();

	const tool_call: ExtensionHandler<
		ToolCallEvent,
		ToolCallEventResult
	> = async (event, ctx) => {
		if (event.toolName === 'read') {
			const input = v.safeParse(read_schema, event.input);

			if (
				input.success &&
				(await is_private_key_source(
					await canonical_path(input.output.path, ctx.cwd),
				))
			) {
				return {
					block: true,
					reason:
						'pi-redact blocked reading a private-key source. Use a public key or inspect non-secret metadata instead.',
				};
			}
		}

		if (event.toolName !== 'write') return;

		const parsed = v.safeParse(write_schema, event.input);

		if (!parsed.success) return;

		const path = await canonical_path(parsed.output.path, ctx.cwd);
		const previous = masked_reads.get(path);

		if (!previous) return;

		const introduced = [...previous].filter((value) =>
			parsed.output.content.includes(value),
		);

		if (!introduced.length) return;

		// This check never exposes file bytes to tools, logs or the model.
		const disk = await readFile(path, 'utf8').catch(() => undefined);

		if (
			disk === undefined ||
			introduced.some((value) => !disk.includes(value))
		) {
			return {
				block: true,
				reason:
					'pi-redact blocked writing a redaction placeholder into a previously masked file. Use a targeted edit that does not copy the masked value.',
			};
		}
	};

	const tool_result: ExtensionHandler<
		ToolResultEvent,
		ToolResultEventResult
	> = async (event, ctx) => {
		const read =
			event.toolName === 'read' && !event.isError
				? v.safeParse(read_schema, event.input)
				: undefined;

		const path = read?.success
			? await canonical_path(read.output.path, ctx.cwd)
			: undefined;

		const force_ssh_config =
			path !== undefined &&
			/(?:^|\/)(?:\.ssh\/(?:config|config\.d\/.+|conf\.d\/.+)|ssh_config)$/.test(
				path.replaceAll('\\', '/'),
			);

		const redact = (text: string) =>
			redact_output(text, { force_ssh_config });

		const content = redact_text_blocks(event.content, redact);

		if (path) {
			const raw = event.content
				.flatMap((block) =>
					block.type === 'text' ? [block.text] : [],
				)
				.join('');

			const safe = content
				.flatMap((block) =>
					block.type === 'text' ? [block.text] : [],
				)
				.join('');

			if (raw !== safe) {
				const markers = masked_reads.get(path) ?? new Set<string>();

				for (const value of safe.match(marker) ?? [])
					markers.add(value);

				masked_reads.set(path, markers);
			}
		}

		return {
			content,
			details: redact_data(event.details, redact_output),
			structuredContent: redact_data(
				event.structuredContent,
				redact_output,
			),
		};
	};

	return {
		tool_call,
		tool_result,
		clear: () => masked_reads.clear(),
	};
}
