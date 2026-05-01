import { set_context_sidecar_enabled } from '@spences10/pi-context';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	format_mcp_tool_result,
	truncate_mcp_tool_output,
} from './result.js';

const cleanup_dirs: string[] = [];

afterEach(() => {
	set_context_sidecar_enabled(false);
	for (const dir of cleanup_dirs)
		rmSync(dir, { recursive: true, force: true });
	cleanup_dirs.length = 0;
});

function temp_context_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-mcp-context-'));
	cleanup_dirs.push(dir);
	return join(dir, 'context.db');
}

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
			tmp_dir: tmpdir(),
		});

		expect(result.details.truncated).toBe(true);
		expect(result.text).toContain('MCP output truncated');
		expect(result.text).toContain('Full output saved to');
		expect(result.text).not.toContain('needle-at-end');
		expect(result.details.full_output_path).toBeTruthy();
		expect(
			readFileSync(result.details.full_output_path!, 'utf8'),
		).toBe(output);

		rmSync(result.details.full_output_path!);
	});

	it('indexes oversized output into context sidecar when enabled', () => {
		set_context_sidecar_enabled(true, { db_path: temp_context_db() });
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
	});

	it('truncates oversized line output', () => {
		const output = ['one', 'two', 'three', 'four'].join('\n');
		const result = truncate_mcp_tool_output(output, {
			max_bytes: 1_000,
			max_lines: 2,
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

		rmSync(result.details.full_output_path!);
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
