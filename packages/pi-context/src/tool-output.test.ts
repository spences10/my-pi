import type { ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vite-plus/test';
import { select_context_output } from './tool-output.js';

function select(event: Record<string, unknown>, preview = 'preview') {
	return select_context_output(
		event as unknown as ToolResultEvent,
		preview,
	);
}

describe('select_context_output', () => {
	it.each(['bash', 'powershell'])(
		'uses complete structured %s output',
		(toolName) => {
			expect(
				select({
					toolName,
					structuredContent: { output: 'complete', truncated: false },
				}),
			).toBe('complete');
		},
	);

	it('marks bounded structured output as partial and preserves its full-output path', () => {
		const text = select({
			toolName: 'bash',
			structuredContent: {
				output: 'head ... tail',
				truncated: true,
				full_output_path: '/tmp/full.txt',
			},
		});
		expect(text).toContain('Partial native output');
		expect(text).toContain('/tmp/full.txt');
		expect(text).toContain('head ... tail');
	});

	it('uses native MCP text and ignores image payloads', () => {
		expect(
			select({
				toolName: 'mcp__docs__extract',
				structuredContent: {
					content: [
						{ type: 'text', text: 'first' },
						{ type: 'image', data: 'base64' },
						{ type: 'text', text: 'last' },
					],
				},
			}),
		).toBe('first\nlast');
	});

	it('marks a truncated read preview as partial', () => {
		expect(
			select({
				toolName: 'read',
				details: { truncation: { truncated: true } },
			}),
		).toContain('Partial native output');
	});

	it('does not label an untruncated result as partial', () => {
		expect(
			select({
				toolName: 'read',
				details: { truncation: { truncated: false } },
			}),
		).toBe('preview');
	});

	it('marks a native MCP preview as partial when structured content was dropped', () => {
		expect(
			select({
				toolName: 'mcp__docs__extract',
				details: { fullOutputPath: '/tmp/native.txt' },
			}),
		).toContain('Partial native output');
	});

	it('keeps converted resource links instead of dropping them for raw text alone', () => {
		expect(
			select(
				{
					toolName: 'mcp__docs__extract',
					structuredContent: {
						content: [
							{ type: 'text', text: 'raw text' },
							{ type: 'resource_link', uri: 'file:///docs' },
						],
					},
				},
				'text plus converted resource link',
			),
		).toBe('text plus converted resource link');
	});

	it.each([undefined, null, 42, [], { output: 42 }])(
		'falls back when structured output is unavailable or invalid: %j',
		(structuredContent) => {
			expect(select({ toolName: 'bash', structuredContent })).toBe(
				'preview',
			);
		},
	);

	it('does not reinterpret arbitrary custom tool structured data', () => {
		expect(
			select({
				toolName: 'custom',
				structuredContent: { output: 'not native' },
			}),
		).toBe('preview');
	});
});
