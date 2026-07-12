import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOTER_STATE } from '../presets/types.js';
import {
	make_context,
	make_footer_data,
	test_theme,
} from '../test-utils.js';
import { render_footer_lines } from './footer-lines.js';

describe('render_footer_lines', () => {
	it('renders minimal preset as one line', () => {
		const lines = render_footer_lines(
			make_context(),
			test_theme,
			make_footer_data(),
			{ ...DEFAULT_FOOTER_STATE, preset: 'minimal' },
			300,
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('claude-sonnet');
	});

	it('does not duplicate smart status labels', () => {
		const lines = render_footer_lines(
			make_context(),
			test_theme,
			make_footer_data({
				getExtensionStatuses: vi.fn(
					() =>
						new Map([
							['mcp', '\u001B[2mMCP 6/6 connected\u001B[22m'],
						]),
				),
			}),
			DEFAULT_FOOTER_STATE,
			120,
		);
		expect(lines.join('\n')).toContain('MCP 6/6 connected');
		expect(lines.join('\n')).not.toContain('mcp:MCP');
	});

	it('can force status labels', () => {
		const lines = render_footer_lines(
			make_context(),
			test_theme,
			make_footer_data({
				getExtensionStatuses: vi.fn(
					() => new Map([['mcp', 'MCP 6/6 connected']]),
				),
			}),
			{ ...DEFAULT_FOOTER_STATE, status_label_mode: 'always' },
			120,
		);
		expect(lines.join('\n')).toContain('mcp:MCP 6/6 connected');
	});

	it('splits task state from service and usage telemetry', () => {
		const lines = render_footer_lines(
			make_context(),
			test_theme,
			make_footer_data({
				getExtensionStatuses: vi.fn(
					() =>
						new Map([
							['mcp', 'MCP 5/5 connected'],
							['codex-usage', 'codex-usage:cx 3h 6%'],
							['harness', 'harness: running'],
							['preset', 'prompt:terse'],
						]),
				),
			}),
			DEFAULT_FOOTER_STATE,
			160,
		);

		expect(lines).toHaveLength(4);
		expect(lines[2]).toContain('harness: running');
		expect(lines[2]).toContain('prompt:terse');
		expect(lines[3]).toContain('MCP 5/5 connected');
		expect(lines[3]).toContain('codex-usage:cx 3h 6%');
	});

	it('supports custom placement and hiding', () => {
		const lines = render_footer_lines(
			make_context(),
			test_theme,
			make_footer_data({
				getExtensionStatuses: vi.fn(
					() =>
						new Map([
							['custom', 'ready'],
							['mcp', 'MCP 5/5 connected'],
						]),
				),
			}),
			{
				...DEFAULT_FOOTER_STATE,
				status_layout: {
					...DEFAULT_FOOTER_STATE.status_layout,
					custom: {
						row: 3,
						alignment: 'center',
						hidden: false,
					},
					mcp: {
						row: 2,
						alignment: 'left',
						hidden: true,
					},
				},
			},
			120,
		);

		expect(lines.join('\n')).toContain('custom:ready');
		expect(lines.join('\n')).not.toContain('MCP 5/5 connected');
	});
});
