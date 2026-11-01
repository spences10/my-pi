import {
	CustomEditor,
	type KeybindingsManager,
	type Theme,
} from '@earendil-works/pi-coding-agent';
import {
	CURSOR_MARKER,
	type EditorTheme,
	type TUI,
} from '@earendil-works/pi-tui';
import { star_color, star_frame, type Star } from './stars.js';

export type StarfieldMode = 'on' | 'static' | 'off';
// Stars pulse over 9–14 s, so a slower frame looks the same.
export const FRAME_MS = 500;
const RESET = '\x1b[0m';

export class StarfieldEditor extends CustomEditor {
	private timer?: ReturnType<typeof setTimeout>;
	private disposed = false;
	private started = performance.now();
	private stars: Star[] = [];
	private top_stars: Star[] = [];
	// Set while the input has text: the top row stays still so Pi's
	// redraw starts below the text and keeps any mouse selection in it.
	private text_elapsed?: number;

	constructor(
		tui: TUI,
		editor_theme: EditorTheme,
		keybindings: KeybindingsManager,
		private options: {
			theme: () => Theme;
			mode: () => StarfieldMode;
			active: () => boolean;
			/** Ghost-text prompt shown in the empty input; Tab accepts it. */
			suggestion?: () => string | undefined;
			on_accept_suggestion?: () => void;
		},
	) {
		super(tui, editor_theme, keybindings);
	}

	private enabled(): boolean {
		return (
			!this.disposed &&
			this.options.active() &&
			this.options.mode() !== 'off'
		);
	}

	private star_cells(
		width: number,
		row: number,
		stars: Star[] = this.stars,
	): string[] {
		const cells = Array<string>(width).fill(' ');
		const theme = this.options.theme();
		for (const star of stars) {
			if (star.y !== row) continue;
			const color =
				star_color(
					theme.getFgAnsi('muted'),
					theme.getBgAnsi('userMessageBg'),
					star.brightness,
				) ?? theme.getFgAnsi('dim');
			cells[star.x] = `${color}${star.glyph}\x1b[39m`;
		}
		return cells;
	}

	protected override renderTopBorder(
		width: number,
		hidden: number,
	): string {
		return this.enabled() && hidden === 0
			? this.star_cells(width, 0, this.top_stars).join('')
			: super.renderTopBorder(width, hidden);
	}

	protected override renderBottomBorder(
		width: number,
		hidden: number,
	): string {
		return this.enabled() && hidden === 0
			? this.star_cells(width, 2).join('')
			: super.renderBottomBorder(width, hidden);
	}

	private stop(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.stop();
	}

	override handleInput(data: string): void {
		const suggestion = this.options.suggestion?.();
		if (
			data === '\t' &&
			suggestion &&
			this.getText() === '' &&
			!this.isShowingAutocomplete()
		) {
			this.setText(suggestion);
			this.options.on_accept_suggestion?.();
			this.tui.requestRender();
			return;
		}
		super.handleInput(data);
	}

	refresh(): void {
		this.stop();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		this.stop();
		if (!this.enabled()) return super.render(width);
		const animated =
			this.options.mode() === 'on' && this.focused && width >= 4;
		const elapsed = animated ? performance.now() - this.started : 0;
		const has_text = this.getText() !== '';
		if (!has_text) this.text_elapsed = undefined;
		else this.text_elapsed ??= elapsed;
		this.stars = width >= 4 ? star_frame(width, elapsed) : [];
		this.top_stars =
			width >= 4 && this.text_elapsed !== undefined
				? star_frame(width, this.text_elapsed)
				: this.stars;
		// Let Pi lay out text and autocomplete. Only its padding rows get stars.
		const lines = super.render(width);
		const theme = this.options.theme();
		const background = theme.getBgAnsi('userMessageBg');
		const empty = this.getText() === '';

		if (empty && !this.isShowingAutocomplete() && width >= 4) {
			const cells = this.star_cells(width, 1);
			const padding = Math.min(
				this.getPaddingX(),
				Math.floor((width - 1) / 2),
			);
			const suggestion = this.options.suggestion?.();
			const text = suggestion
				? `${suggestion}  ⇥`.slice(0, width - padding - 1)
				: '';
			// Replace all suggestion cells, including spaces, to protect them from stars.
			for (let index = 0; index < text.length; index++) {
				cells[padding + index] = theme.fg('dim', text[index]!);
			}
			if (this.focused) {
				cells[padding] =
					`${CURSOR_MARKER}\x1b[7m${cells[padding]}\x1b[27m`;
			}
			lines[1] = cells.join('');
		}

		if (animated) {
			this.timer = setTimeout(() => {
				this.timer = undefined;
				if (
					this.enabled() &&
					this.focused &&
					this.options.mode() === 'on'
				)
					this.tui.requestRender();
			}, FRAME_MS);
			this.timer.unref();
		}
		return lines.map((line) => {
			const shaded = line
				.replaceAll(RESET, RESET + background)
				.replaceAll('\x1b[49m', '\x1b[49m' + background)
				.replaceAll('\x1b[m', '\x1b[m' + background);
			return `${background}${shaded}${RESET}`;
		});
	}
}
