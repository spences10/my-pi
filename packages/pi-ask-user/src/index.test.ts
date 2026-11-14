import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	make_api,
	make_custom_ui,
	make_keybindings,
	make_theme,
	make_tool_context,
} from '../../../tools/test-sdk.js';
import {
	make_terminal,
	make_tui,
} from '../../../tools/test-terminal.js';
import ask_user, { create_question_tool } from './index.js';
import {
	matching_indices,
	QuestionPicker,
	type QuestionAnswer,
	type QuestionOptions,
} from './picker.js';

const enter = '\r';
const escape = '\u001b';
const down = '\u001b[B';
const up = '\u001b[A';
const clear = '\u0015';
const search_key = '\u0006';
const comment_key = '\u001bc';
const other_key = '\u001bo';

const params: QuestionOptions = {
	question: 'Which projects?',
	options: [
		{ label: 'alpha', description: 'Frontend app' },
		{ label: 'beta', description: 'Backend API' },
		{ label: 'gamma', description: 'Shared library' },
	],
	multiSelect: true,
};

async function answer(keys: string[], options = params) {
	const abort = vi.fn();

	const ctx = make_tool_context({
		abort,
		ui: { custom: make_custom_ui([keys]) },
	});

	const result = await create_question_tool().execute(
		'question-1',
		options,
		undefined,
		undefined,
		ctx,
	);

	return { abort, result };
}

function picker(options = params, rows = 24) {
	const terminal = make_terminal({ rows });
	const { tui } = make_tui(terminal);
	const done = vi.fn<(result: QuestionAnswer | null) => void>();
	const controller = new AbortController();

	const component = new QuestionPicker(
		options,
		tui,
		make_theme(),
		make_keybindings(),
		done,
		controller.signal,
	);

	component.focused = true;

	return { component, done, controller, terminal };
}

describe('questionnaire', () => {
	it('registers the existing tool name and optional, non-gating guidance', () => {
		const register = vi.fn();
		const api = make_api({ registerTool: register });

		ask_user(api);
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'ask_user_question',
				executionMode: 'sequential',
			}),
		);
		expect(
			create_question_tool().promptGuidelines?.join(' '),
		).toContain('not a decision gate');
	});

	it('matches complete labels and descriptions case-insensitively', () => {
		expect(matching_indices(params.options, ' API ')).toEqual([1]);
		expect(matching_indices(params.options, '')).toEqual([0, 1, 2]);
		expect(matching_indices(params.options, 'missing')).toEqual([]);
	});

	it('keeps selections across filters and returns original list order', async () => {
		const { result } = await answer([
			search_key,
			'beta',
			enter,
			' ',
			search_key,
			clear,
			'alpha',
			enter,
			' ',
			enter,
		]);

		expect(result.details).toEqual({
			status: 'answered',
			cancelled: false,
			answers: ['alpha', 'beta'],
		});
	});

	it('toggles a selection off after clearing the filter', async () => {
		const { result } = await answer([
			' ',
			search_key,
			'beta',
			enter,
			search_key,
			clear,
			enter,
			up,
			' ',
			enter,
		]);

		expect(result.details).toMatchObject({ answers: [] });
	});

	it('combines selections, Other text and a qualifying comment', async () => {
		const { abort, result } = await answer([
			' ',
			other_key,
			'delta',
			enter,
			comment_key,
			'Only check dependencies',
			enter,
			enter,
		]);

		expect(result.details).toEqual({
			status: 'answered',
			cancelled: false,
			answers: ['alpha'],
			other: 'delta',
			comment: 'Only check dependencies',
		});
		expect(
			JSON.parse(
				result.content[0].type === 'text'
					? result.content[0].text
					: '',
			),
		).toMatchObject({ comment: 'Only check dependencies' });
		expect(abort).not.toHaveBeenCalled();
	});

	it('supports a comment before a single selection', async () => {
		const { result } = await answer(
			[comment_key, 'Just inspect', enter, down, enter],
			{ ...params, multiSelect: false },
		);

		expect(result.details).toMatchObject({
			answers: ['beta'],
			comment: 'Just inspect',
		});
	});

	it('supports a custom-only single answer', async () => {
		const { result } = await answer(
			[other_key, 'Neither; discuss it first', enter],
			{ ...params, multiSelect: false },
		);

		expect(result.details).toMatchObject({
			answers: [],
			other: 'Neither; discuss it first',
		});
	});

	it('discards an edit without losing the earlier comment or selection', async () => {
		const { result } = await answer([
			' ',
			comment_key,
			'Keep this',
			enter,
			comment_key,
			clear,
			'Discard this',
			escape,
			enter,
		]);

		expect(result.details).toMatchObject({
			answers: ['alpha'],
			comment: 'Keep this',
		});
	});

	it('can clear a saved Other answer', async () => {
		const { result } = await answer([
			' ',
			other_key,
			'delta',
			enter,
			other_key,
			clear,
			enter,
			enter,
		]);

		expect(result.details).toEqual({
			status: 'answered',
			cancelled: false,
			answers: ['alpha'],
		});
	});

	it('dismisses to chat without treating unsubmitted selections as answers', async () => {
		const { abort, result } = await answer([
			' ',
			comment_key,
			'Unsubmitted',
			enter,
			escape,
		]);

		expect(abort).toHaveBeenCalledOnce();
		expect(result.terminate).toBe(true);
		expect(result.details).toEqual({
			cancelled: true,
			status: 'dismissed',
		});
		expect(result.content).toEqual([
			{
				type: 'text',
				text: expect.stringContaining('task itself was not rejected'),
			},
		]);
	});

	it('keeps explicit empty submission distinct from dismissal', async () => {
		const { abort, result } = await answer([enter]);

		expect(result.details).toEqual({
			status: 'answered',
			cancelled: false,
			answers: [],
		});
		expect(abort).not.toHaveBeenCalled();
	});

	it.each(['rpc', 'print', 'json'] as const)(
		'reports unavailable in %s without claiming the user declined',
		async (mode) => {
			const ctx = make_tool_context({ mode });
			const custom = vi.spyOn(ctx.ui, 'custom');
			const abort = vi.spyOn(ctx, 'abort');

			const result = await create_question_tool().execute(
				'q',
				params,
				undefined,
				undefined,
				ctx,
			);

			expect(result.details).toEqual({
				unavailable: true,
				status: 'unavailable',
			});
			expect(custom).not.toHaveBeenCalled();
			expect(abort).not.toHaveBeenCalled();
		},
	);

	it('does not open an already aborted request', async () => {
		const ctx = make_tool_context();
		const custom = vi.spyOn(ctx.ui, 'custom');

		const result = await create_question_tool().execute(
			'q',
			params,
			AbortSignal.abort(),
			undefined,
			ctx,
		);

		expect(result.details).toEqual({
			cancelled: true,
			status: 'aborted',
		});
		expect(custom).not.toHaveBeenCalled();
	});
});

describe('picker interaction', () => {
	it('shows hidden selections and allows search with no matches', () => {
		const { component } = picker();

		component.handleInput(' ');
		component.handleInput(search_key);
		component.handleInput('no-such-project');
		expect(component.render(100).join('\n')).toContain(
			'1 selected · 1 hidden',
		);
		expect(component.render(100).join('\n')).toContain(
			'No matching options',
		);
		component.handleInput(escape);
		expect(component.render(100).join('\n')).toContain(
			'Filter: (all)',
		);
		component.dispose();
	});

	it('uses original option identities after scrolling a long list', () => {
		const { component, done } = picker({
			...params,
			options: Array.from({ length: 40 }, (_, i) => ({
				label: `project-${i}`,
			})),
		});

		for (let i = 0; i < 30; i++) component.handleInput(down);

		component.handleInput(' ');
		component.handleInput(enter);
		expect(done).toHaveBeenCalledWith({
			cancelled: false,
			answers: ['project-30'],
		});
	});

	it('bounds rendered lines on narrow terminals and retains state across resize', () => {
		const { component, terminal, done } = picker(
			{ ...params, question: '選択してください '.repeat(20) },
			12,
		);

		component.handleInput(' ');
		component.handleInput(comment_key);
		component.handleInput('A long comment '.repeat(8));

		for (const width of [20, 40, 100]) {
			const lines = component.render(width);

			expect(lines.length).toBeLessThanOrEqual(terminal.rows);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(
				true,
			);
		}

		component.handleInput(enter);
		terminal.rows = 20;
		component.render(80);
		component.handleInput(enter);
		expect(done).toHaveBeenCalledWith(
			expect.objectContaining({ answers: ['alpha'] }),
		);
	});

	it('aborts during editing exactly once and cleans up the listener', () => {
		const { component, controller, done } = picker();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');

		component.handleInput(comment_key);
		controller.abort();
		component.handleInput(escape);
		expect(done).toHaveBeenCalledExactlyOnceWith(null);
		expect(remove).toHaveBeenCalledWith(
			'abort',
			expect.any(Function),
		);
	});
});
