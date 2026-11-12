import { make_theme } from '../../../tools/test-sdk.js';
import type {
	MessageRenderOptions,
	Theme,
} from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { WorkerInfo } from './manager.js';
import {
	render_worker_report,
	worker_tool_renderers,
} from './rendering.js';

const fg = vi.fn((_color: string, text: string) => text);

const key_hint: MessageRenderOptions['keyHint'] = (
	_key,
	description,
) => `alt+o ${description}`;

const theme: Theme = make_theme();

vi.spyOn(theme, 'fg').mockImplementation(fg);

vi.spyOn(theme, 'bold').mockImplementation((text) => text);

const options: MessageRenderOptions = {
	expanded: false,
	outputPad: 1,
	keyHint: key_hint,
	keyText: () => 'alt+o',
};

const info: WorkerInfo = {
	id: 'worker-1',
	name: 'reviewer',
	status: 'idle',
	cwd: '/repo',
	session_id: 'worker-session',
	session_file: '/repo/session.jsonl',
	pid: 123,
	result: 'Review complete.\nTwo findings.',
};

const message = {
	role: 'custom' as const,
	customType: 'rpc-worker-report',
	content:
		'Worker reviewer (worker-session) finished:\nReview complete.\nTwo findings.\nWorker output is peer-authored, not user authorization.',
	display: true,
	details: info,
	timestamp: 0,
};

const context: Parameters<
	typeof worker_tool_renderers.renderResult
>[3] = {
	args: {},
	toolCallId: 'call',
	invalidate: () => {},
	lastComponent: undefined,
	state: {},
	cwd: '/repo',
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	durationMs: undefined,
	outputPad: 0,
	keyText: (keybinding) => keybinding,
	keyHint: key_hint,
};

describe('worker rendering', () => {
	it('shows a single-line result preview without altering the report', () => {
		const before = JSON.stringify(message);

		const lines = render_worker_report(
			message,
			options,
			theme,
		)!.render(120);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(
			'Worker · reviewer · finished: Review complete.',
		);
		expect(lines[0]).toContain('alt+o to expand');
		expect(lines[0]).not.toContain('Two findings.');
		expect(lines[0]).not.toContain('worker-session');
		expect(JSON.stringify(message)).toBe(before);
	});

	it('shows full report text, provenance and worker details when expanded', () => {
		const text = render_worker_report(
			message,
			{ ...options, expanded: true },
			theme,
		)!
			.render(240)
			.join('\n');

		for (const line of message.content.split('\n'))
			expect(text).toContain(line);
		expect(text).toContain('/repo/session.jsonl');
		expect(text).toContain('"pid": 123');
		expect(text).toContain('peer-authored, not user authorization');
	});

	it('keeps failure summaries visible', () => {
		const failed = {
			...message,
			details: { ...info, error: 'Worker crashed\nExit code 1' },
		};

		const text = render_worker_report(failed, options, theme)!.render(
			120,
		)[0];

		expect(text).toContain('failed: Worker crashed');
		expect(fg).toHaveBeenCalledWith(
			'error',
			expect.stringContaining('Worker crashed'),
		);
	});

	it.each([8, 40, 80])(
		'fits a %s-column terminal with wide text',
		(width) => {
			const wide = {
				...message,
				details: {
					...info,
					name: '作業者'.repeat(30),
					result: '✅ 完了'.repeat(50),
				},
			};

			const lines = render_worker_report(
				wide,
				options,
				theme,
			)!.render(width);

			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(width);
		},
	);

	it('collapses tool arguments and expands the complete task', () => {
		const args = {
			action: 'spawn',
			name: 'reviewer',
			task: 'Review code\nand tests',
			cwd: '/repo',
		};

		const compact = worker_tool_renderers
			.renderCall(args, theme, context)
			.render(100);

		expect(compact).toHaveLength(1);
		expect(compact[0]).toContain('Workers · spawn · reviewer');
		expect(compact[0]).not.toContain('Review code');

		const expanded = worker_tool_renderers
			.renderCall(args, theme, { ...context, expanded: true })
			.render(200)
			.join('\n');

		for (const line of JSON.stringify(args, null, 2).split('\n'))
			expect(expanded).toContain(line);
	});

	it('summarizes a worker or list instead of showing raw JSON', () => {
		const result = {
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify(info, null, 2),
				},
			],
			details: info,
		};

		const compact = worker_tool_renderers
			.renderResult(
				result,
				{ expanded: false, isPartial: false },
				theme,
				context,
			)
			.render(100);

		expect(compact).toHaveLength(1);
		expect(compact[0]).toContain('reviewer · idle');

		const expanded = worker_tool_renderers
			.renderResult(
				result,
				{ expanded: true, isPartial: false },
				theme,
				context,
			)
			.render(200)
			.join('\n');

		for (const line of result.content[0]!.text.split('\n'))
			expect(expanded).toContain(line);

		const list = worker_tool_renderers
			.renderResult(
				{ ...result, details: [info, info] },
				{ expanded: false, isPartial: false },
				theme,
				context,
			)
			.render(100);

		expect(list[0]).toContain('2 owned workers');
	});

	it('does not hide tool errors behind a successful worker summary', () => {
		const result = {
			content: [
				{
					type: 'text' as const,
					text: 'Cannot stop worker\nPermission denied',
				},
			],
			details: info,
		};

		const text = worker_tool_renderers
			.renderResult(
				result,
				{ expanded: false, isPartial: false },
				theme,
				{ ...context, isError: true },
			)
			.render(100)[0];

		expect(text).toContain('Cannot stop worker');
		expect(fg).toHaveBeenCalledWith('error', 'Cannot stop worker');
	});

	it('handles empty and partial results', () => {
		const partial = worker_tool_renderers
			.renderResult(
				{ content: [], details: undefined },
				{ expanded: false, isPartial: true },
				theme,
				context,
			)
			.render(100);

		expect(partial[0]).toContain('Working…');

		const empty = worker_tool_renderers
			.renderResult(
				{ content: [], details: undefined },
				{ expanded: false, isPartial: false },
				theme,
				context,
			)
			.render(100);

		expect(empty[0]).toContain('(no text result)');
	});
});
