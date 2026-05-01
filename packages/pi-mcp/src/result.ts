import { maybe_store_context_output } from '@spences10/pi-context';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MCP_RESULT_MAX_BYTES = 50 * 1024;
export const MCP_RESULT_MAX_LINES = 2_000;

export interface McpResultTruncationDetails {
	truncated: boolean;
	bytes: number;
	lines: number;
	max_bytes: number;
	max_lines: number;
	preview_bytes?: number;
	preview_lines?: number;
	full_output_path?: string;
}

export function format_mcp_tool_result(
	result: unknown,
	options: {
		tool_name?: string;
		input_summary?: string | null;
	} = {},
): {
	text: string;
	details: McpResultTruncationDetails;
} {
	return truncate_mcp_tool_output(
		stringify_mcp_tool_result(result),
		options,
	);
}

export function stringify_mcp_tool_result(result: unknown): string {
	if (
		result &&
		typeof result === 'object' &&
		Array.isArray((result as { content?: unknown }).content)
	) {
		return (result as { content: Array<{ text?: unknown }> }).content
			.map((content) =>
				typeof content.text === 'string' ? content.text : '',
			)
			.join('\n');
	}

	const json = JSON.stringify(result);
	return typeof json === 'string' ? json : String(result);
}

export function truncate_mcp_tool_output(
	text: string,
	options: {
		max_bytes?: number;
		max_lines?: number;
		tmp_dir?: string;
		tool_name?: string;
		input_summary?: string | null;
	} = {},
): { text: string; details: McpResultTruncationDetails } {
	const max_bytes = options.max_bytes ?? MCP_RESULT_MAX_BYTES;
	const max_lines = options.max_lines ?? MCP_RESULT_MAX_LINES;
	const bytes = Buffer.byteLength(text, 'utf8');
	const lines = count_lines(text);

	if (bytes <= max_bytes && lines <= max_lines) {
		return {
			text,
			details: {
				truncated: false,
				bytes,
				lines,
				max_bytes,
				max_lines,
			},
		};
	}

	const context_output = try_store_context_output(text, {
		tool_name: options.tool_name ?? 'mcp',
		input_summary: options.input_summary,
	});
	if (context_output) {
		return {
			text: context_output.receipt,
			details: {
				truncated: true,
				bytes,
				lines,
				max_bytes,
				max_lines,
				preview_bytes: Buffer.byteLength(
					context_output.preview,
					'utf8',
				),
				preview_lines: count_lines(context_output.preview),
				full_output_path: `context:${context_output.source_id}`,
			},
		};
	}

	const full_output_path = write_full_output(text, options.tmp_dir);
	let preview = take_first_lines(text, max_lines);
	preview = take_first_utf8_bytes(preview, max_bytes);

	const preview_bytes = Buffer.byteLength(preview, 'utf8');
	const preview_lines = count_lines(preview);
	const notice = [
		`[MCP output truncated: ${format_bytes(bytes)} across ${lines} lines; showing first ${format_bytes(preview_bytes)} / ${preview_lines} lines.]`,
		`Full output saved to ${full_output_path}`,
		'Use rg/read against that file to inspect the remainder.',
	].join('\n');

	return {
		text: preview ? `${preview}\n\n${notice}` : notice,
		details: {
			truncated: true,
			bytes,
			lines,
			max_bytes,
			max_lines,
			preview_bytes,
			preview_lines,
			full_output_path,
		},
	};
}

function try_store_context_output(
	text: string,
	options: { tool_name: string; input_summary?: string | null },
): { source_id: string; preview: string; receipt: string } | null {
	try {
		return maybe_store_context_output({
			text,
			tool_name: options.tool_name,
			input_summary: options.input_summary,
			force: true,
		});
	} catch {
		return null;
	}
}

function count_lines(text: string): number {
	if (text.length === 0) return 0;
	return text.split('\n').length;
}

function take_first_lines(text: string, max_lines: number): string {
	const lines = text.split('\n');
	if (lines.length <= max_lines) return text;
	return lines.slice(0, max_lines).join('\n');
}

function take_first_utf8_bytes(
	text: string,
	max_bytes: number,
): string {
	if (Buffer.byteLength(text, 'utf8') <= max_bytes) return text;

	let bytes = 0;
	let output = '';
	for (const char of text) {
		const char_bytes = Buffer.byteLength(char, 'utf8');
		if (bytes + char_bytes > max_bytes) break;
		bytes += char_bytes;
		output += char;
	}
	return output;
}

function write_full_output(text: string, tmp_dir = tmpdir()): string {
	const path = join(
		tmp_dir,
		`my-pi-mcp-output-${process.pid}-${Date.now()}-${randomUUID()}.txt`,
	);
	writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
	return path;
}

function format_bytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KiB`;
}
