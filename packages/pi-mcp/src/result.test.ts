import {
	get_context_store,
	set_context_sidecar_enabled,
} from '@spences10/pi-context';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	format_mcp_tool_result,
	stringify_mcp_tool_result,
	truncate_mcp_tool_output,
} from './result.js';

const cleanup_dirs: string[] = [];

function temp_dir(prefix = 'pi-mcp-context-'): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	cleanup_dirs.push(dir);
	return dir;
}

function temp_context_db(): string {
	return join(temp_dir(), 'context.db');
}

afterEach(() => {
	set_context_sidecar_enabled(false);
	for (const dir of cleanup_dirs)
		rmSync(dir, { recursive: true, force: true });
	cleanup_dirs.length = 0;
});

describe('truncate_mcp_tool_output', () => {
	it('leaves small output unchanged', () => {
		const result = truncate_mcp_tool_output('hello', {
			max_bytes: 50,
			max_lines: 5,
		});

		expect(result.text).toBe('hello');
		expect(result.details).toMatchObject({
			truncated: false,
			bytes: 5,
			lines: 1,
		});
	});

	it('truncates oversized byte output and saves the full text', () => {
		const output = `start\n${'x'.repeat(80)}\nneedle-at-end`;
		const result = truncate_mcp_tool_output(output, {
			max_bytes: 24,
			max_lines: 20,
			tmp_dir: temp_dir('pi-mcp-output-'),
		});

		expect(result.details.truncated).toBe(true);
		expect(result.text).toContain('MCP output truncated');
		expect(result.text).toContain('Full output saved to');
		expect(result.text).not.toContain('needle-at-end');
		expect(result.details.full_output_path).toBeTruthy();
		expect(
			readFileSync(result.details.full_output_path!, 'utf8'),
		).toBe(output);
	});

	it('indexes oversized output into context sidecar when enabled', () => {
		const db_path = temp_context_db();
		set_context_sidecar_enabled(true, { db_path });
		const output = `start\n${'x'.repeat(80)}\nneedle-at-end`;
		const result = truncate_mcp_tool_output(output, {
			max_bytes: 24,
			max_lines: 20,
			tool_name: 'mcp__demo__large',
		});

		expect(result.details.truncated).toBe(true);
		expect(result.details.full_output_path).toMatch(/^context:ctx_/);
		expect(result.text).toContain('[context-sidecar]');
		expect(result.text).toContain('context_search');
		expect(result.text).toContain('needle-at-end');

		const source_id = result.details.full_output_path!.replace(
			'context:',
			'',
		);
		const results = get_context_store({ db_path }).search(
			'needle-at-end',
			{
				source_id,
				tool_name: 'mcp__demo__large',
			},
		);
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe(output);
	});

	it('falls back to temp-file truncation if the context store cannot open', () => {
		const invalid_db_path = temp_dir('pi-mcp-invalid-db-');
		const tmp_output_dir = temp_dir('pi-mcp-output-');
		set_context_sidecar_enabled(true, { db_path: invalid_db_path });
		const output = `start\n${'x'.repeat(80)}\nfallback-token`;

		const result = truncate_mcp_tool_output(output, {
			max_bytes: 24,
			max_lines: 20,
			tmp_dir: tmp_output_dir,
		});

		expect(result.details.truncated).toBe(true);
		expect(result.details.full_output_path).not.toMatch(/^context:/);
		expect(result.text).toContain('MCP output truncated');
		expect(
			readFileSync(result.details.full_output_path!, 'utf8'),
		).toBe(output);
	});

	it('truncates oversized line output', () => {
		const output = ['one', 'two', 'three', 'four'].join('\n');
		const result = truncate_mcp_tool_output(output, {
			max_bytes: 1_000,
			max_lines: 2,
			tmp_dir: temp_dir('pi-mcp-output-'),
		});

		expect(result.details).toMatchObject({
			truncated: true,
			lines: 4,
			preview_lines: 2,
		});
		expect(
			result.text.startsWith('one\ntwo\n\n[MCP output truncated:'),
		).toBe(true);
		expect(
			readFileSync(result.details.full_output_path!, 'utf8'),
		).toBe(output);
	});

	it('does not split multibyte characters while byte-truncating previews', () => {
		const output = `${'😀'.repeat(20)}\nend`;
		const result = truncate_mcp_tool_output(output, {
			max_bytes: 18,
			max_lines: 20,
			tmp_dir: temp_dir('pi-mcp-output-'),
		});

		expect(result.details.truncated).toBe(true);
		expect(result.text).toContain('😀😀😀😀');
		expect(result.text).not.toContain('\uFFFD');
		expect(
			readFileSync(result.details.full_output_path!, 'utf8'),
		).toBe(output);
	});
});

describe('stringify_mcp_tool_result', () => {
	it('joins text content and ignores non-text content', () => {
		expect(
			stringify_mcp_tool_result({
				content: [
					{ type: 'text', text: 'one' },
					{ type: 'image', data: 'ignored' },
					{ type: 'text', text: 'two' },
				],
			}),
		).toBe('one\n\ntwo');
	});

	it('falls back to JSON for non-content results', () => {
		expect(stringify_mcp_tool_result({ ok: true })).toBe(
			'{"ok":true}',
		);
		expect(stringify_mcp_tool_result(undefined)).toBe('undefined');
	});
});

describe('format_mcp_tool_result', () => {
	it('formats and truncates MCP text content', () => {
		const result = format_mcp_tool_result({
			content: [{ type: 'text', text: 'a'.repeat(60_000) }],
		});

		expect(result.details.truncated).toBe(true);
		expect(result.details.max_bytes).toBe(50 * 1024);
		expect(result.text).toContain('MCP output truncated');
		expect(result.details.full_output_path).toBeTruthy();

		rmSync(result.details.full_output_path!);
	});
});
