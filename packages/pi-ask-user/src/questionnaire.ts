import type {
	KeybindingsManager,
	Theme,
} from '@earendil-works/pi-coding-agent';
import {
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type TUI,
} from '@earendil-works/pi-tui';
import {
	QuestionPicker,
	type QuestionAnswer,
	type QuestionOptions,
} from './picker.js';
import { render_tabs } from './tabs.js';

export interface QuestionResponse {
	questionIndex: number;
	question: string;
	status: 'answered' | 'unanswered';
	answer?: QuestionAnswer;
}

export interface BatchAnswer {
	cancelled: false;
	responses: QuestionResponse[];
}

export function answer_lines(answer: QuestionAnswer): string[] {
	const lines = answer.answers.map((label) => `✓ ${label}`);

	if (answer.other) lines.push(`Other: ${answer.other}`);

	if (answer.comment) lines.push(`Comment: ${answer.comment}`);

	if (!lines.length) lines.push('No options selected');

	return lines;
}

/** Each question owns its draft, filter, categories and selection state. */
export class Questionnaire implements Component, Focusable {
	private pickers: QuestionPicker[];
	private tab = 0;
	private has_focus = false;
	private finished = false;
	private review_offset = 0;

	constructor(
		private questions: QuestionOptions[],
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private done: (answer: BatchAnswer | null) => void,
		private signal?: AbortSignal,
	) {
		this.pickers = questions.map(
			(question) =>
				new QuestionPicker(
					question,
					tui,
					theme,
					keybindings,
					(answer) => {
						if (answer === null) this.finish(null);
						else this.switch_tab(this.tab + 1);
					},
					undefined,
					true,
				),
		);
		signal?.addEventListener('abort', this.abort, { once: true });

		if (signal?.aborted) queueMicrotask(this.abort);
	}

	get focused(): boolean {
		return this.has_focus;
	}
	set focused(value: boolean) {
		this.has_focus = value;
		this.pickers.forEach((picker, index) => {
			picker.focused = value && index === this.tab;
		});
	}

	private abort = (): void => {
		this.finish(null);
	};

	private finish(answer: BatchAnswer | null): void {
		if (this.finished) return;

		this.finished = true;
		this.dispose();
		this.done(answer);
	}

	dispose(): void {
		this.signal?.removeEventListener('abort', this.abort);
		this.pickers.forEach((picker) => picker.dispose());
	}

	invalidate(): void {
		this.pickers.forEach((picker) => picker.invalidate());
	}

	private responses(): QuestionResponse[] {
		return this.questions.map((question, index) => {
			const answer = this.pickers[index].get_answer();

			const response: QuestionResponse = {
				questionIndex: index,
				question: question.question,
				status: 'unanswered',
			};

			if (answer) {
				response.status = 'answered';
				response.answer = answer;
			}

			return response;
		});
	}

	private switch_tab(next: number): void {
		this.pickers[this.tab]?.leave();
		this.tab =
			(next + this.questions.length + 1) %
			(this.questions.length + 1);
		this.focused = this.has_focus;
		this.review_offset = 0;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.finished) return;

		const navigate_with_arrows = !this.pickers[this.tab]?.is_editing;

		if (
			matchesKey(data, Key.tab) ||
			(navigate_with_arrows && matchesKey(data, Key.right))
		)
			this.switch_tab(this.tab + 1);
		else if (
			matchesKey(data, Key.shift('tab')) ||
			(navigate_with_arrows && matchesKey(data, Key.left))
		)
			this.switch_tab(this.tab - 1);
		else if (this.tab < this.questions.length)
			this.pickers[this.tab].handleInput(data);
		else if (this.keybindings.matches(data, 'tui.select.cancel'))
			this.finish(null);
		else if (this.keybindings.matches(data, 'tui.select.confirm'))
			this.finish({ cancelled: false, responses: this.responses() });
		else {
			if (this.keybindings.matches(data, 'tui.select.up'))
				this.review_offset--;

			if (this.keybindings.matches(data, 'tui.select.down'))
				this.review_offset++;

			if (matchesKey(data, Key.pageUp))
				this.review_offset -= Math.max(1, this.tui.terminal.rows - 4);

			if (matchesKey(data, Key.pageDown))
				this.review_offset += Math.max(1, this.tui.terminal.rows - 4);

			this.review_offset = Math.max(0, this.review_offset);
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const columns = Math.max(1, width);

		const labels = this.questions.map((question, index) => {
			const mark = this.pickers[index].get_answer() ? '✓ ' : '';

			return mark + (question.header || `Q${index + 1}`);
		});

		labels.push('Review');

		const tabs = this.theme.fg(
			'accent',
			render_tabs(labels, this.tab, columns),
		);

		const help = this.theme.fg(
			'dim',
			'←/→ or Tab/Shift+Tab questions · Esc chat',
		);

		if (this.tab < this.questions.length)
			return [
				tabs,
				...this.pickers[this.tab].render(columns, 2),
				truncateToWidth(help, columns),
			];

		const lines = this.responses().flatMap((response) => {
			const summary = response.answer
				? answer_lines(response.answer)
				: ['Unanswered (no choice inferred)'];

			return [
				this.theme.fg(
					'accent',
					`${response.questionIndex + 1}. ${response.question}`,
				),
				...summary,
				'',
			].flatMap((line) => wrapTextWithAnsi(line, columns));
		});

		const height = Math.max(1, this.tui.terminal.rows - 4);

		this.review_offset = Math.min(
			this.review_offset,
			Math.max(0, lines.length - height),
		);
		const footer = `↑↓ scroll · Enter submit · ${this.review_offset + 1}-${Math.min(lines.length, this.review_offset + height)}/${lines.length}`;

		return [
			tabs,
			...lines.slice(this.review_offset, this.review_offset + height),
			this.theme.fg('dim', footer),
			help,
		].map((line) => truncateToWidth(line, columns));
	}
}
