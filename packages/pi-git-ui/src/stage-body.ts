import type { Focusable } from '@earendil-works/pi-tui';
import type { ModalBody, ModalTheme } from '@spences10/pi-tui-modal';
import { CommitComposer } from './commit-composer.js';
import {
	changed_line_indexes,
	commit,
	discard_file,
	EMPTY_STATUS,
	format_git_error,
	has_staged_changes,
	read_diff,
	read_repo_overview,
	read_status,
	stage_all,
	stage_file,
	stage_hunk,
	stage_line,
	staged_file_count,
	toggle_file,
	unstage_all,
	unstage_file,
	unstage_hunk,
	unstage_line,
	type DiffHunk,
	type DiffView,
	type GitFile,
	type GitStatus,
	type RepoOverview,
} from './git.js';
import {
	key_is_down,
	key_is_up,
	state_label,
	status_code,
} from './render.js';
import {
	build_discard_confirmation,
	build_stage_actions,
	next_action_index,
} from './stage-action-menu.js';
import { render_stage } from './stage-render.js';
import type { ActionItem } from './stage-types.js';

export class GitStageBody implements ModalBody, Focusable {
	private selected = 0;
	private diff_scroll = 0;
	private selected_hunk = 0;
	private selected_line_index: number | undefined;
	private status: GitStatus = EMPTY_STATUS;
	private diff?: DiffView;
	private diff_for_path = '';
	private busy = false;
	private message = '';
	private filter_text = '';
	private capturing_filter = false;
	private actions?: ActionItem[];
	private selected_action = 0;
	private repo_overview?: RepoOverview;
	private show_help = false;
	private composer?: CommitComposer;
	private diff_request_id = 0;
	private _focused = false;

	constructor(
		private readonly cwd: string,
		private readonly theme: ModalTheme,
		private readonly request_render: () => void,
		private readonly done: () => void,
	) {}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;

		if (this.composer) this.composer.focused = value;
	}

	async load(preferred_path?: string): Promise<void> {
		this.busy = true;
		this.message = 'Loading git status…';
		this.request_render();

		try {
			this.status = await read_status(this.cwd);
			this.restore_selection(preferred_path);
			this.message =
				this.status.files.length === 0 ? 'Working tree clean' : '';
			await this.load_diff();
		} catch (error) {
			this.status = EMPTY_STATUS;
			this.diff = undefined;
			this.message = format_git_error(error);
		} finally {
			this.busy = false;
			this.request_render();
		}
	}

	render(width: number): string[] {
		if (this.composer) return this.composer.render(width);

		return render_stage(
			{
				theme: this.theme,
				status: this.status,
				message: this.message,
				busy: this.busy,
				visible_files: this.visible_files(),
				selected: this.selected,
				diff: this.diff,
				diff_for_path: this.diff_for_path,
				diff_scroll: this.diff_scroll,
				selected_hunk: this.selected_hunk,
				selected_line_index: this.selected_line_index,
				actions: this.actions,
				selected_action: this.selected_action,
				repo_overview: this.repo_overview,
				show_help: this.show_help,
			},
			width,
		);
	}

	handleInput(data: string): void {
		if (this.composer) {
			this.composer.handleInput(data);
			this.request_render();

			return;
		}

		if (this.actions) {
			this.handle_action_input(data);
			this.request_render();

			return;
		}

		if (this.show_help) {
			if (data === '\x1B' || data === 'q' || data === '?')
				this.show_help = false;
			this.request_render();

			return;
		}

		if (this.repo_overview) {
			if (data === '\x1B' || data === 'q')
				this.repo_overview = undefined;
			this.request_render();

			return;
		}

		if (this.capturing_filter) {
			this.handle_filter_input(data);
			this.request_render();

			return;
		}

		if (this.busy) return;

		if (data === 'q' || data === '\x1B') {
			this.done();

			return;
		}

		if (key_is_up(data)) this.move_selection(-1);
		else if (key_is_down(data)) this.move_selection(1);
		else if (data === '\x1B[C' || data === 'l') this.scroll_diff(4);
		else if (data === '\x1B[D' || data === 'h') this.scroll_diff(-4);
		else if (data === ' ') void this.toggle_selected();
		else if (data === 's') void this.stage_selected();
		else if (data === 'x') void this.unstage_selected();
		else if (data === 'S') void this.stage_selected_hunk();
		else if (data === 'X') void this.unstage_selected_hunk();
		else if (data === '+') void this.stage_selected_line();
		else if (data === '-') void this.unstage_selected_line();
		else if (data === ']') this.move_line(1);
		else if (data === '[') this.move_line(-1);
		else if (data === 'n') this.move_hunk(1);
		else if (data === 'p') this.move_hunk(-1);
		else if (data === 'a') void this.stage_all_safely();
		else if (data === 'A')
			void this.run(
				() => stage_all(this.cwd),
				'Force-staged all changes',
			);
		else if (data === 'u')
			void this.run(
				() => unstage_all(this.cwd),
				'Unstaged all changes',
			);
		else if (data === 'g') void this.open_repo_overview();
		else if (data === 'c') this.open_commit_composer();
		else if (data === 'm') this.open_commit_composer(true);
		else if (data === '\r' || data === '\n') this.open_action_menu();
		else if (data === '?') this.show_help = true;
		else if (data === '/') this.start_filter();
		else if (data === 'r') void this.load(this.selected_file()?.path);
		this.request_render();
	}

	invalidate(): void {
		this.composer?.invalidate();
	}

	private visible_files(): GitFile[] {
		const query = this.filter_text.trim().toLowerCase();

		if (!query) return this.status.files;

		return this.status.files.filter((file) => {
			const searchable_text = `${file.path} ${state_label(file.state)} ${status_code(file)}`;

			return searchable_text.toLowerCase().includes(query);
		});
	}

	private selected_file(): GitFile | undefined {
		return this.visible_files()[this.selected];
	}

	private restore_selection(preferred_path?: string): void {
		const files = this.visible_files();
		const path = preferred_path ?? files[this.selected]?.path;

		const index = path
			? files.findIndex((file) => file.path === path)
			: -1;

		this.selected =
			index >= 0
				? index
				: Math.min(this.selected, Math.max(0, files.length - 1));
	}

	private move_selection(delta: number): void {
		const files = this.visible_files();

		const next = Math.max(
			0,
			Math.min(files.length - 1, this.selected + delta),
		);

		if (next === this.selected) return;
		this.selected = next;
		this.diff_scroll = 0;
		this.selected_hunk = 0;
		this.selected_line_index = undefined;
		void this.load_diff();
	}

	private scroll_diff(delta: number): void {
		this.diff_scroll = Math.max(0, this.diff_scroll + delta);
	}

	private start_filter(): void {
		this.capturing_filter = true;
		this.message = this.filter_text
			? `Filter: ${this.filter_text}`
			: 'Filter: type to narrow files';
	}

	private handle_filter_input(data: string): void {
		if (data === '\r' || data === '\n' || data === '\x1B') {
			this.capturing_filter = false;
			this.message = this.filter_text
				? `Filtered by ${this.filter_text}`
				: '';

			return;
		}

		if (data === '\x7F' || data === '\b') {
			this.filter_text = this.filter_text.slice(0, -1);
		} else if (data === '\x15') {
			this.filter_text = '';
		} else if (data.length === 1 && data >= ' ') {
			this.filter_text += data;
		}

		this.selected = 0;
		this.diff_scroll = 0;
		this.selected_hunk = 0;
		this.selected_line_index = undefined;
		this.message = this.filter_text
			? `Filter: ${this.filter_text}`
			: 'Filter cleared';
		void this.load_diff();
	}

	private move_hunk(delta: number): void {
		if (!this.diff || this.diff.hunks.length === 0) {
			this.message = 'No hunks in selected diff.';

			return;
		}

		this.selected_hunk = Math.max(
			0,
			Math.min(
				this.diff.hunks.length - 1,
				this.selected_hunk + delta,
			),
		);
		const hunk = this.selected_diff_hunk();

		if (hunk) {
			this.diff_scroll = hunk.line_index;
			this.selected_line_index = changed_line_indexes(hunk)[0];
		}
	}

	private move_line(delta: number): void {
		const indexes = this.stageable_line_indexes();

		if (indexes.length === 0) {
			this.message = 'No stageable lines in selected diff.';

			return;
		}

		const current = this.selected_line_index ?? indexes[0]!;
		const current_index = Math.max(0, indexes.indexOf(current));

		const next =
			indexes[
				Math.max(
					0,
					Math.min(indexes.length - 1, current_index + delta),
				)
			]!;

		this.selected_line_index = next;
		this.diff_scroll = next;

		const hunk_index = this.diff?.hunks.findIndex((hunk) =>
			changed_line_indexes(hunk).includes(next),
		);

		if (hunk_index !== undefined && hunk_index >= 0)
			this.selected_hunk = hunk_index;
	}

	private stageable_line_indexes(): number[] {
		return this.diff?.hunks.flatMap(changed_line_indexes) ?? [];
	}

	private selected_line_hunk(): DiffHunk | undefined {
		return this.diff?.hunks.find((hunk) =>
			this.selected_line_index === undefined
				? false
				: changed_line_indexes(hunk).includes(
						this.selected_line_index,
					),
		);
	}

	private async load_diff(): Promise<void> {
		const request_id = ++this.diff_request_id;
		const file = this.selected_file();

		if (!file) {
			this.diff = undefined;
			this.diff_for_path = '';

			return;
		}

		const path = file.path;
		this.diff_for_path = path;

		try {
			const diff = await read_diff(this.cwd, file);

			if (request_id !== this.diff_request_id) return;
			this.diff = diff;
			this.selected_hunk = Math.min(
				this.selected_hunk,
				Math.max(0, this.diff.hunks.length - 1),
			);
			this.selected_line_index ??= this.stageable_line_indexes()[0];
		} catch (error) {
			if (request_id !== this.diff_request_id) return;
			this.diff = {
				path,
				lines: [format_git_error(error)],
				hunks: [],
			};
		}

		this.request_render();
	}

	private async toggle_selected(): Promise<void> {
		const file = this.selected_file();

		if (!file) return;
		const verb = file.state === 'staged' ? 'Unstaged' : 'Staged';
		await this.run(
			() => toggle_file(this.cwd, file),
			`${verb} ${file.path}`,
		);
	}

	private async stage_selected(): Promise<void> {
		const file = this.selected_file();

		if (!file) return;
		await this.run(
			() => stage_file(this.cwd, file),
			`Staged ${file.path}`,
		);
	}

	private async unstage_selected(): Promise<void> {
		const file = this.selected_file();

		if (!file) return;
		await this.run(
			() => unstage_file(this.cwd, file),
			`Unstaged ${file.path}`,
		);
	}

	private selected_diff_hunk(): DiffHunk | undefined {
		return this.diff?.hunks[this.selected_hunk];
	}

	private async stage_selected_hunk(): Promise<void> {
		const hunk = this.selected_diff_hunk();

		if (!hunk) {
			this.message = 'No hunk selected.';

			return;
		}

		await this.run(() => stage_hunk(this.cwd, hunk), 'Staged hunk');
	}

	private async unstage_selected_hunk(): Promise<void> {
		const hunk = this.selected_diff_hunk();

		if (!hunk) {
			this.message = 'No hunk selected.';

			return;
		}

		await this.run(
			() => unstage_hunk(this.cwd, hunk),
			'Unstaged hunk',
		);
	}

	private async stage_selected_line(): Promise<void> {
		const hunk = this.selected_line_hunk();

		if (!hunk || this.selected_line_index === undefined) {
			this.message = 'No line selected.';

			return;
		}

		await this.run(
			() => stage_line(this.cwd, hunk, this.selected_line_index!),
			'Staged line',
		);
	}

	private async unstage_selected_line(): Promise<void> {
		const hunk = this.selected_line_hunk();

		if (!hunk || this.selected_line_index === undefined) {
			this.message = 'No line selected.';

			return;
		}

		await this.run(
			() => unstage_line(this.cwd, hunk, this.selected_line_index!),
			'Unstaged line',
		);
	}

	private async stage_all_safely(): Promise<void> {
		const unsafe = this.status.files.find(
			(file) => file.state === 'mixed' || file.state === 'conflicted',
		);

		if (unsafe) {
			this.message = `Stage all blocked by ${state_label(unsafe.state)} file ${unsafe.path}. Use A to force.`;

			return;
		}

		await this.run(() => stage_all(this.cwd), 'Staged all changes');
	}

	private open_action_menu(): void {
		const file = this.selected_file();

		if (!file) {
			this.message = 'No file selected.';

			return;
		}

		this.actions = build_stage_actions(file, {
			stage_file: () => void this.stage_selected(),
			unstage_file: () => void this.unstage_selected(),
			stage_hunk: () => void this.stage_selected_hunk(),
			unstage_hunk: () => void this.unstage_selected_hunk(),
			stage_line: () => void this.stage_selected_line(),
			unstage_line: () => void this.unstage_selected_line(),
			discard_file: (selected) =>
				this.open_discard_confirmation(selected),
			commit: () => this.open_commit_composer(),
			amend_commit: () => this.open_commit_composer(true),
			repository: () => void this.open_repo_overview(),
			refresh: (path) => void this.load(path),
			conflict_help: (selected) => this.show_conflict_help(selected),
		});
		this.selected_action = 0;
	}

	private handle_action_input(data: string): void {
		if (data === '\x1B' || data === 'q') {
			this.actions = undefined;

			return;
		}

		const next = next_action_index(
			this.selected_action,
			this.actions?.length ?? 1,
			data,
		);

		if (next !== this.selected_action) {
			this.selected_action = next;

			return;
		}

		if (data !== '\r' && data !== '\n') return;
		const action = this.actions?.[this.selected_action];
		this.actions = undefined;
		action?.run();
	}

	private show_conflict_help(file: GitFile): void {
		this.actions = undefined;
		this.message = `Resolve ${file.path} in your editor, then stage it with s when conflict markers are gone.`;
	}

	private async open_repo_overview(): Promise<void> {
		this.busy = true;
		this.message = 'Loading repository overview…';
		this.request_render();

		try {
			this.repo_overview = await read_repo_overview(this.cwd);
		} catch (error) {
			this.message = format_git_error(error);
		} finally {
			this.busy = false;
			this.request_render();
		}
	}

	private open_discard_confirmation(file: GitFile): void {
		this.actions = build_discard_confirmation(
			file,
			(selected) => void this.discard_file(selected),
			() => {
				this.actions = undefined;
			},
		);
		this.selected_action = 1;
	}

	private async discard_file(file: GitFile): Promise<void> {
		await this.run(
			() => discard_file(this.cwd, file),
			`Discarded unstaged changes in ${file.path}`,
		);
	}

	private open_commit_composer(amend = false): void {
		if (!has_staged_changes(this.status.files)) {
			this.message = amend
				? 'No staged changes to amend.'
				: 'No staged changes to commit.';

			return;
		}

		this.composer = new CommitComposer(
			this.theme,
			staged_file_count(this.status.files),
			(message) => void this.commit_staged(message, amend),
			() => {
				this.composer = undefined;
			},
			amend,
		);
		this.composer.focused = this.focused;
	}

	private async commit_staged(
		message: string,
		amend = false,
	): Promise<void> {
		this.composer = undefined;
		await this.run(
			() => commit(this.cwd, message, { amend }),
			amend ? `Amended ${message}` : `Committed ${message}`,
		);
	}

	private async run(
		action: () => Promise<void>,
		success: string,
	): Promise<void> {
		const path = this.selected_file()?.path;
		this.busy = true;
		this.message = 'Working…';
		this.request_render();

		try {
			await action();
			this.message = success;
			this.status = await read_status(this.cwd);
			this.restore_selection(path);
			this.diff_scroll = 0;
			this.selected_line_index = undefined;
			await this.load_diff();
		} catch (error) {
			this.message = format_git_error(error);
		} finally {
			this.busy = false;
			this.request_render();
		}
	}
}
