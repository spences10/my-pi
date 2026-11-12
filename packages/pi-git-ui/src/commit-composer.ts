import { Input, Text, type Focusable } from '@earendil-works/pi-tui';
import type { ModalTheme } from '@spences10/pi-tui-modal';
import { truncate_plain } from './render.js';

const TYPES = [
	{ key: 'f', type: 'feat', label: 'feature' },
	{ key: 'x', type: 'fix', label: 'bug fix' },
	{ key: 'd', type: 'docs', label: 'docs' },
	{ key: 'r', type: 'refactor', label: 'refactor' },
	{ key: 't', type: 'test', label: 'tests' },
	{ key: 'h', type: 'chore', label: 'chore' },
] as const;

type CommitStep = 'type' | 'summary';

export class CommitComposer implements Focusable {
	private step: CommitStep = 'type';
	private selected_type = 'feat';
	private conventional = true;
	private readonly input = new Input();

	constructor(
		private readonly theme: ModalTheme,
		private readonly staged_count: number,
		private readonly on_commit: (message: string) => void,
		private readonly on_cancel: () => void,
		private readonly amend = false,
	) {
		this.input.onSubmit = (summary) => this.submit(summary);
		this.input.onEscape = () => this.on_cancel();
	}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	render(width: number): string[] {
		if (this.step === 'type') return this.render_type_picker(width);

		return this.render_summary(width);
	}

	handleInput(data: string): void {
		if (this.step === 'type') {
			if (data === '\x1B' || data === 'q') {
				this.on_cancel();

				return;
			}

			if (data === 'n') {
				this.conventional = false;
				this.step = 'summary';

				return;
			}

			const match = TYPES.find((type) => type.key === data);

			if (match) {
				this.selected_type = match.type;
				this.conventional = true;
				this.step = 'summary';
			}

			return;
		}

		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private render_type_picker(width: number): string[] {
		const lines = [
			this.theme.bold(
				this.amend ? 'Amend last commit' : 'Commit staged changes',
			),
			this.theme.fg(
				'muted',
				`${this.staged_count} staged file${this.staged_count === 1 ? '' : 's'}`,
			),
			'',
			'Choose commit format:',
		];

		for (const item of TYPES) {
			lines.push(
				`  ${this.theme.fg('accent', item.key)}  ${item.type.padEnd(8)} ${this.theme.fg('dim', item.label)}`,
			);
		}

		lines.push(
			`  ${this.theme.fg('accent', 'n')}  raw      ${this.theme.fg('dim', 'plain git commit message')}`,
			'',
			this.theme.fg('dim', 'esc/q cancel'),
		);

		return lines.flatMap((line) =>
			new Text(line, 0, 0).render(width),
		);
	}

	private render_summary(width: number): string[] {
		const preview = this.build_message(this.input.getValue().trim());

		const lines = [
			this.theme.bold(
				this.amend ? 'Amend message' : 'Commit message',
			),
			this.theme.fg(
				'muted',
				`${this.staged_count} staged file${this.staged_count === 1 ? '' : 's'}`,
			),
			'',
			this.conventional
				? `Format: ${this.theme.fg('accent', `${this.selected_type}(git-ui): <summary>`)}`
				: 'Format: raw commit message',
			`Preview: ${preview ? this.theme.fg('success', truncate_plain(preview, Math.max(10, width - 9))) : this.theme.fg('dim', 'waiting for summary…')}`,
			'',
			'Summary:',
			...this.input.render(width),
			'',
			this.theme.fg(
				'dim',
				this.amend
					? 'enter amend • esc cancel'
					: 'enter commit • esc cancel',
			),
		];

		return lines;
	}

	private submit(summary: string): void {
		const message = this.build_message(summary.trim());

		if (!message) return;
		this.on_commit(message);
	}

	private build_message(summary: string): string {
		if (!summary) return '';

		if (!this.conventional) return summary;

		return `${this.selected_type}(git-ui): ${summary}`;
	}
}
