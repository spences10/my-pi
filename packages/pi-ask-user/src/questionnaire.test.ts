import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	make_custom_ui,
	make_keybindings,
	make_theme,
	make_tool_context,
} from '../../../tools/test-sdk.js';
import {
	make_terminal,
	make_tui,
} from '../../../tools/test-terminal.js';
import {
	create_question_tool,
	normalise_questions,
} from './index.js';
import {
	matching_indices,
	QuestionPicker,
	type QuestionAnswer,
	type QuestionOptions,
} from './picker.js';
import { Questionnaire, type BatchAnswer } from './questionnaire.js';
import { render_tabs } from './tabs.js';

const enter = '\r';
const escape = '\u001b';
const tab = '\t';
const previous = '\u001b[Z';
const right_category = '\u001b[1;3C';
const left_category = '\u001b[1;3D';
const comment = '\u001bc';
const other = '\u001bo';
const clear = '\u0015';
const down = '\u001b[B';
const up = '\u001b[A';

const projects: QuestionOptions = {
	question: 'Which projects?',
	header: 'Projects',
	multiSelect: true,
	options: [
		{ label: 'website', category: 'Frontend' },
		{
			label: 'console',
			description: 'Admin app',
			category: 'Frontend',
		},
		{ label: 'orders', category: 'Backend' },
		{ label: 'shared' },
	],
};

const checks: QuestionOptions = {
	question: 'Which checks?',
	header: 'Checks',
	options: [{ label: 'Types' }, { label: 'Tests' }],
};

function questionnaire(questions = [projects, checks], rows = 24) {
	const { tui } = make_tui(make_terminal({ rows }));
	const done = vi.fn<(answer: BatchAnswer | null) => void>();
	const controller = new AbortController();

	const component = new Questionnaire(
		questions,
		tui,
		make_theme(),
		make_keybindings(),
		done,
		controller.signal,
	);

	component.focused = true;

	return { component, done, controller };
}

function category_picker() {
	const { tui } = make_tui();
	const done = vi.fn<(answer: QuestionAnswer | null) => void>();

	const component = new QuestionPicker(
		projects,
		tui,
		make_theme(),
		make_keybindings(),
		done,
	);

	component.focused = true;

	return { component, done };
}

function keys(
	component: { handleInput(data: string): void },
	...inputs: string[]
): void {
	inputs.forEach((input) => component.handleInput(input));
}

describe('categories and direct search', () => {
	it('starts searching on ordinary typing, including former c/o shortcuts', () => {
		const { component, done } = category_picker();

		keys(component, 'c', 'o', 'n');
		expect(component.render(100).join('\n')).toContain(
			'Filter: con · 1/4',
		);
		keys(component, enter, ' ', enter);
		expect(done).toHaveBeenCalledWith({
			cancelled: false,
			answers: ['console'],
		});
	});

	it('accepts slash as search text rather than forcing a search shortcut', () => {
		const { component } = category_picker();

		keys(component, '/');
		expect(component.render(100).join('\n')).toContain('Filter: /');
		component.dispose();
	});

	it('preserves selections across category tabs, search and All', () => {
		const { component, done } = category_picker();

		keys(
			component,
			right_category,
			' ',
			right_category,
			'orders',
			enter,
			' ',
			right_category,
		);
		expect(component.render(100).join('\n')).toContain(
			'[Uncategorized]',
		);
		keys(
			component,
			'\u0006',
			clear,
			enter,
			' ',
			right_category,
			enter,
		);
		expect(done).toHaveBeenCalledWith({
			cancelled: false,
			answers: ['website', 'orders', 'shared'],
		});
	});

	it('does not confuse a literal category named All with the all-options tab', () => {
		const options = [{ label: 'a', category: 'All' }, { label: 'b' }];

		expect(matching_indices(options, '', 'All')).toEqual([0]);
		expect(matching_indices(options, '', '')).toEqual([1]);
		expect(matching_indices(options, '')).toEqual([0, 1]);
	});

	it('keeps drafts when moving categories during search', () => {
		const { component } = category_picker();

		keys(component, 'orders', right_category);
		expect(component.render(100).join('\n')).toContain(
			'No matching options',
		);
		keys(component, right_category);
		expect(component.render(100).join('\n')).toContain('orders');
		expect(component.render(100).join('\n')).toContain('1/4 options');
		keys(component, left_category);
		expect(component.render(100).join('\n')).toContain('[Frontend]');
		component.dispose();
	});
});

describe('question tabs and review', () => {
	it('navigates question and review tabs with arrows, preserving selections and wrapping', () => {
		const { component, done } = questionnaire();

		keys(component, ' ', '\u001b[C');
		expect(component.render(100).join('\n')).toContain('[Checks]');
		keys(component, '\u001b[D');
		expect(component.render(100).join('\n')).toContain('[x] website');
		keys(component, '\u001b[D');
		expect(component.render(100).join('\n')).toContain('[Review]');
		keys(component, '\u001b[C');
		expect(component.render(100).join('\n')).toContain(
			'[✓ Projects]',
		);
		expect(done).not.toHaveBeenCalled();
		component.dispose();
	});

	it.each([
		['search', ''],
		['comment', comment],
		['Other', other],
	])('keeps arrows in the %s text editor', (_name, shortcut) => {
		const { component } = questionnaire();

		if (shortcut) keys(component, shortcut);
		keys(component, 'ab', '\u001b[D', 'X', '\u001b[C', 'Y');
		const view = component.render(100).join('\n');

		expect(view).toContain('[Projects]');
		expect(view).toContain('aXbY');
		keys(component, enter, '\u001b[C');
		expect(component.render(100).join('\n')).toContain('[Checks]');
		component.dispose();
	});
	it('supports categories within several questions and reviews before submission', () => {
		const { component, done } = questionnaire();

		keys(
			component,
			right_category,
			' ',
			right_category,
			' ',
			comment,
			'Only inspect',
			enter,
			enter,
		);
		expect(component.render(100).join('\n')).toContain('[Checks]');
		expect(done).not.toHaveBeenCalled();
		keys(component, down, enter);
		expect(component.render(100).join('\n')).toContain('[Review]');
		expect(component.render(100).join('\n')).toContain(
			'Only inspect',
		);
		expect(done).not.toHaveBeenCalled();
		keys(component, enter);
		expect(done).toHaveBeenCalledWith({
			cancelled: false,
			responses: [
				{
					questionIndex: 0,
					question: projects.question,
					status: 'answered',
					answer: {
						cancelled: false,
						answers: ['website', 'orders'],
						comment: 'Only inspect',
					},
				},
				{
					questionIndex: 1,
					question: checks.question,
					status: 'answered',
					answer: { cancelled: false, answers: ['Tests'] },
				},
			],
		});
	});

	it('retains each question’s filter, category and editable answers when revisiting', () => {
		const { component, done } = questionnaire();

		keys(
			component,
			right_category,
			'console',
			enter,
			' ',
			tab,
			down,
			enter,
			previous,
			up,
			enter,
			previous,
			previous,
		);
		const view = component.render(100).join('\n');

		expect(view).toContain('[Frontend]');
		expect(view).toContain('Filter: console');
		expect(view).toContain('[x] console');
		keys(
			component,
			' ',
			other,
			'another project',
			enter,
			enter,
			tab,
			enter,
		);
		const result = done.mock.calls[0]?.[0];

		expect(result?.responses[0].answer).toEqual({
			cancelled: false,
			answers: [],
			other: 'another project',
		});
		expect(result?.responses[1].answer?.answers).toEqual(['Types']);
	});

	it('saves text drafts on question-tab navigation and keeps comments scoped', () => {
		const { component, done } = questionnaire();

		keys(
			component,
			comment,
			'Project qualification',
			tab,
			other,
			'Lint instead',
			tab,
		);
		expect(component.render(100).join('\n')).toContain(
			'Project qualification',
		);
		expect(component.render(100).join('\n')).toContain(
			'Lint instead',
		);
		keys(component, enter);
		const result = done.mock.calls[0]?.[0];

		expect(result?.responses[0].answer?.comment).toBe(
			'Project qualification',
		);
		expect(result?.responses[1].answer?.other).toBe('Lint instead');
		expect(result?.responses[1].answer?.comment).toBeUndefined();
	});

	it('keeps unanswered questions distinct from explicitly empty selections', () => {
		const { component, done } = questionnaire();

		keys(component, enter, tab);
		expect(component.render(100).join('\n')).toContain(
			'Unanswered (no choice inferred)',
		);
		keys(component, enter);
		const result = done.mock.calls[0]?.[0];

		expect(result?.responses[0]).toMatchObject({
			status: 'answered',
			answer: { answers: [] },
		});
		expect(result?.responses[1]).toEqual({
			questionIndex: 1,
			question: checks.question,
			status: 'unanswered',
		});
	});

	it('never returns draft answers when dismissed from the review screen', () => {
		const { component, done } = questionnaire();

		keys(component, ' ', tab, enter, escape);
		expect(done).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('closes a batch on external abort while editing a later question', () => {
		const { component, done, controller } = questionnaire();

		keys(component, tab, comment, 'Draft');
		controller.abort();
		keys(component, enter, escape);
		expect(done).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('fits category/question tabs and editors in a short terminal', () => {
		const { component } = questionnaire(
			[
				{ ...projects, question: 'A long question '.repeat(10) },
				checks,
			],
			12,
		);

		keys(component, 'nothing-matches');

		for (const width of [20, 40, 100]) {
			const lines = component.render(width);

			expect(lines.length).toBeLessThanOrEqual(12);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(
				true,
			);
		}

		component.dispose();
	});

	it('scrolls long review text and keeps the active tab visible on narrow screens', () => {
		const { component } = questionnaire(
			Array.from({ length: 12 }, (_, index) => ({
				...checks,
				header: `Question-${index}`,
			})),
			12,
		);

		keys(component, previous);
		expect(component.render(30).join('\n')).toContain(
			'13/13 [Review]',
		);
		keys(component, '\u001b[6~');
		expect(component.render(30).join('\n')).not.toContain(
			'1. Which checks?',
		);
		expect(component.render(30).length).toBeLessThanOrEqual(12);
		expect(render_tabs(['A', 'B', 'C'], 2, 80)).toContain('[C]');
		component.dispose();
	});
});

describe('tool inputs and results', () => {
	it('accepts both shapes without adding limits on question or option counts', () => {
		expect(normalise_questions(projects)).toMatchObject([
			{ question: projects.question },
		]);
		expect(
			normalise_questions({ questions: [projects, checks] }),
		).toEqual([projects, checks]);
		expect(() => normalise_questions({})).toThrow(
			'Provide question and options',
		);
		expect(() => normalise_questions({ questions: [] })).toThrow(
			'at least one',
		);
		expect(() =>
			normalise_questions({ ...projects, questions: [checks] }),
		).toThrow('not both');
	});

	it('returns a structured batch through the tool, including one-question batches', async () => {
		const ctx = make_tool_context({
			ui: { custom: make_custom_ui([[enter, enter]]) },
		});

		const result = await create_question_tool().execute(
			'q',
			{ questions: [checks] },
			undefined,
			undefined,
			ctx,
		);

		expect(result.details).toMatchObject({
			status: 'answered',
			responses: [
				{ questionIndex: 0, answer: { answers: ['Types'] } },
			],
		});
	});

	it('stops the agent on batch dismissal without inferring any answers', async () => {
		const abort = vi.fn();

		const ctx = make_tool_context({
			abort,
			ui: { custom: make_custom_ui([[tab, enter, escape]]) },
		});

		const result = await create_question_tool().execute(
			'q',
			{ questions: [projects, checks] },
			undefined,
			undefined,
			ctx,
		);

		expect(abort).toHaveBeenCalledOnce();
		expect(result.details).toEqual({
			status: 'dismissed',
			cancelled: true,
		});
		expect(result.terminate).toBe(true);
	});
});
