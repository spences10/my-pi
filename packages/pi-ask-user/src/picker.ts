import type {
	KeybindingsManager,
	Theme,
} from '@earendil-works/pi-coding-agent';
import {
	Input,
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type SelectItem,
	type TUI,
} from '@earendil-works/pi-tui';
import { render_tabs } from './tabs.js';

export interface QuestionOptions {
	question: string;
	options: {
		label: string;
		description?: string;
		category?: string;
	}[];
	multiSelect?: boolean;
	header?: string;
}

export interface QuestionAnswer {
	cancelled: false;
	answers: string[];
	other?: string;
	comment?: string;
}

type EditField = 'search' | 'other' | 'comment';

export function matching_indices(
	options: QuestionOptions['options'],
	query: string,
	category?: string,
): number[] {
	const search = query.trim().toLocaleLowerCase();

	return options.flatMap((option, index) => {
		if (
			category !== undefined &&
			(option.category?.trim() ?? '') !== category
		)
			return [];

		const text = `${option.label} ${option.description ?? ''}`;

		return text.toLocaleLowerCase().includes(search) ? [index] : [];
	});
}

/** One interaction; selections use original indices, never filtered positions. */
export class QuestionPicker implements Component, Focusable {
	private selected = new Set<number>();
	private search = '';
	private other = '';
	private comment = '';
	private editing: EditField | undefined;
	private input = new Input();
	private list: SelectList | undefined;
	private cursor = '0';
	private max_visible = 8;
	private has_focus = false;
	private finished = false;
	private answered = false;
	private category = 0;
	private categories: string[];
	private last_query = '';
	private last_category = 0;

	constructor(
		private params: QuestionOptions,
		private tui: TUI,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private done: (answer: QuestionAnswer | null) => void,
		private signal?: AbortSignal,
		private batch = false,
	) {
		this.categories = [
			...new Set(
				params.options.map((option) => option.category?.trim() ?? ''),
			),
		];

		if (!this.categories.some(Boolean)) this.categories = [];
		this.rebuild();
		signal?.addEventListener('abort', this.abort, { once: true });

		// Defer until custom() has attached the component before closing it.
		if (signal?.aborted) queueMicrotask(this.abort);
	}

	get focused(): boolean {
		return this.has_focus;
	}

	set focused(value: boolean) {
		this.has_focus = value;
		this.input.focused = value && this.editing !== undefined;
	}

	private abort = (): void => {
		this.finish(null);
	};

	private finish(answer: QuestionAnswer | null): void {
		if (this.finished) return;

		this.finished = true;
		this.dispose();
		this.done(answer);
	}

	dispose(): void {
		this.signal?.removeEventListener('abort', this.abort);
	}

	invalidate(): void {
		this.list?.invalidate();
		this.input.invalidate();
	}

	get is_editing(): boolean {
		return this.editing !== undefined;
	}

	private query(): string {
		return this.editing === 'search'
			? this.input.getValue()
			: this.search;
	}

	private matches(): number[] {
		return matching_indices(
			this.params.options,
			this.query(),
			this.categories[this.category - 1],
		);
	}

	private rebuild(): void {
		if (
			this.query() !== this.last_query ||
			this.category !== this.last_category
		) {
			// A temporary no-match filter must not leave focus stuck on Other.
			if (!Number.isInteger(Number(this.cursor))) this.cursor = '0';
			this.last_query = this.query();
			this.last_category = this.category;
		}

		const items: SelectItem[] = this.matches().map((index) => {
			const option = this.params.options[index];
			let mark = '';

			if (this.params.multiSelect)
				mark = this.selected.has(index) ? '[x] ' : '[ ] ';
			else if (this.selected.has(index)) mark = '✓ ';

			return {
				value: String(index),
				label: mark + option.label,
				description: option.description,
			};
		});

		items.push(
			{
				value: 'other',
				label: `Other: ${this.other || 'type an answer'}`,
			},
			{
				value: 'comment',
				label: `Comment: ${this.comment || 'optional'}`,
			},
			{
				value: 'submit',
				label: this.batch ? 'Save answer / next' : 'Submit answers',
			},
		);

		this.list = new SelectList(items, this.max_visible, {
			selectedPrefix: (text) => this.theme.fg('accent', text),
			selectedText: (text) => this.theme.fg('accent', text),
			description: (text) => this.theme.fg('muted', text),
			scrollInfo: (text) => this.theme.fg('dim', text),
			noMatch: (text) => this.theme.fg('muted', text),
		});
		this.list.onSelectionChange = (item) => {
			this.cursor = item.value;
		};

		this.list.setSelectedIndex(
			Math.max(
				0,
				items.findIndex((item) => item.value === this.cursor),
			),
		);
		this.cursor = this.list.getSelectedItem()?.value ?? 'other';
	}

	private edit(field: EditField): void {
		this.editing = field;
		this.input = new Input({ prompt: `${field}: ` });
		// Paste restores the value with the cursor at its end; setValue keeps position zero.
		this.input.handleInput(`\u001b[200~${this[field]}\u001b[201~`);
		this.input.focused = this.has_focus;
	}

	get_answer(): QuestionAnswer | undefined {
		if (!this.answered) return undefined;

		const answers = [...this.selected]
			.sort((a, b) => a - b)
			.map((index) => this.params.options[index].label);

		const result: QuestionAnswer = { cancelled: false, answers };

		if (this.other) result.other = this.other;

		if (this.comment) result.comment = this.comment;

		return result;
	}

	private submit(): void {
		this.answered = true;
		const result = this.get_answer()!;

		if (this.batch) this.done(result);
		else this.finish(result);
	}

	/** Switching question tabs saves edits without submitting the questionnaire. */
	leave(): void {
		if (!this.editing) return;

		this.save_edit();
		this.rebuild();
	}

	private save_edit(): void {
		const field = this.editing;

		if (!field) return;

		this[field] = this.input.getValue().trim();

		if (field !== 'search') this.answered = true;

		if (field === 'other' && this.other && !this.params.multiSelect)
			this.selected.clear();
		this.editing = undefined;
		this.input.focused = false;
	}

	handleInput(data: string): void {
		if (this.finished) return;

		const previous_category = matchesKey(data, Key.alt('left'));
		const next_category = matchesKey(data, Key.alt('right'));

		if (
			this.categories.length &&
			(previous_category || next_category) &&
			(!this.editing || this.editing === 'search')
		) {
			this.leave();
			const count = this.categories.length + 1;
			this.category =
				(this.category + (next_category ? 1 : -1) + count) % count;
			this.rebuild();
		} else if (this.editing) {
			if (this.keybindings.matches(data, 'tui.select.cancel')) {
				this.editing = undefined;
				this.input.focused = false;
			} else if (
				this.keybindings.matches(data, 'tui.select.confirm')
			) {
				const field = this.editing;

				this.save_edit();

				if (
					field === 'other' &&
					this.other &&
					!this.params.multiSelect
				) {
					this.selected.clear();
					this.submit();

					return;
				}
			} else if (
				this.editing === 'search' &&
				(this.keybindings.matches(data, 'tui.select.up') ||
					this.keybindings.matches(data, 'tui.select.down'))
			) {
				this.leave();
				this.list?.handleInput(data);
			} else {
				this.input.handleInput(data);
			}

			this.rebuild();
		} else if (this.keybindings.matches(data, 'tui.select.cancel')) {
			this.finish(null);

			return;
		} else if (matchesKey(data, Key.ctrl('f'))) {
			this.edit('search');
		} else if (matchesKey(data, Key.alt('c'))) {
			this.edit('comment');
		} else if (matchesKey(data, Key.alt('o'))) {
			this.edit('other');
		} else if (
			matchesKey(data, Key.space) &&
			this.params.multiSelect
		) {
			const index = Number(this.cursor);

			if (Number.isInteger(index)) {
				this.answered = true;

				if (this.selected.has(index)) this.selected.delete(index);
				else this.selected.add(index);

				this.rebuild();
			}
		} else if (this.keybindings.matches(data, 'tui.select.confirm')) {
			if (this.cursor === 'other' || this.cursor === 'comment') {
				this.edit(this.cursor);
			} else {
				if (!this.params.multiSelect && this.cursor !== 'submit') {
					this.selected = new Set([Number(this.cursor)]);
					this.other = '';
				}

				this.submit();

				return;
			}
		} else if (
			this.keybindings.matches(data, 'tui.select.up') ||
			this.keybindings.matches(data, 'tui.select.down')
		) {
			this.list?.handleInput(data);
		} else {
			this.edit('search');
			this.input.handleInput(data);

			if (this.input.getValue() === this.search) {
				this.editing = undefined;
				this.input.focused = false;
			}

			this.rebuild();
		}

		this.tui.requestRender();
	}

	render(width: number, reserved_rows = 0): string[] {
		const columns = Math.max(1, width);
		const matches = this.matches();

		const hidden = [...this.selected].filter(
			(index) => !matches.includes(index),
		).length;

		const header = wrapTextWithAnsi(
			this.theme.fg('accent', this.params.question),
			columns,
		).slice(0, 2);

		if (this.categories.length) {
			const labels = [
				'All',
				...this.categories.map(
					(category) => category || 'Uncategorized',
				),
			];

			header.push(
				this.theme.fg(
					'accent',
					render_tabs(labels, this.category, columns),
				),
			);
		}

		header.push(
			this.theme.fg(
				'muted',
				`Filter: ${this.query() || '(all)'} · ${matches.length}/${this.params.options.length} options`,
			),
		);

		if (this.params.multiSelect)
			header.push(
				this.theme.fg(
					'muted',
					`${this.selected.size} selected · ${hidden} hidden by filter`,
				),
			);

		if (matches.length === 0)
			header.push(
				this.theme.fg(
					'warning',
					'No matching options. Selections are kept.',
				),
			);

		const footer: string[] = [];

		const category_hint = this.categories.length
			? ' · Alt+←/→ categories'
			: '';

		if (this.editing) {
			footer.push(...this.input.render(columns));
			footer.push(
				this.theme.fg(
					'dim',
					'Enter save · Esc discard/back' + category_hint,
				),
			);
		} else {
			footer.push(
				this.theme.fg(
					'dim',
					'Esc chat · Type to search · Alt+C comment · Alt+O other',
				),
			);
			let hint = '↑↓ move · Enter select';

			if (this.params.multiSelect)
				hint = '↑↓ move · Space toggle · Enter submit';

			if (this.batch) {
				hint = '↑↓ move · Enter select/next';

				if (this.params.multiSelect)
					hint = '↑↓ move · Space toggle · Enter save/next';
			}

			footer.push(this.theme.fg('dim', hint + category_hint));
		}

		const visible = Math.max(
			1,
			Math.min(
				8,
				this.tui.terminal.rows -
					reserved_rows -
					header.length -
					footer.length -
					2,
			),
		);

		if (visible !== this.max_visible) {
			this.max_visible = visible;
			this.rebuild();
		}

		return [...header, ...this.list!.render(columns), ...footer].map(
			(line) => truncateToWidth(line, columns),
		);
	}
}
