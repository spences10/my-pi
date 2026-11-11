import { Text } from '@earendil-works/pi-tui';
import {
	staged_file_count,
	type FileState,
	type GitFile,
} from './git.js';
import {
	pad_ansi,
	pad_plain,
	state_counts,
	state_icon,
	state_label,
	status_code,
	truncate_plain,
} from './render.js';
import type { StageRenderState } from './stage-types.js';

export function render_stage(
	state: StageRenderState,
	width: number,
): string[] {
	if (state.actions) return render_action_menu(state, width);

	if (state.show_help) return render_help(state, width);

	if (state.repo_overview) return render_repo_overview(state, width);
	const lines = render_header(state, width);

	if (state.message) lines.push(...render_message(state, width));

	if (state.status.files.length === 0) return lines;

	return [...lines, ...render_workbench(state, width)];
}

function render_header(
	state: StageRenderState,
	width: number,
): string[] {
	const upstream = state.status.upstream
		? ` • ${state.status.upstream} ↑${state.status.ahead} ↓${state.status.behind}`
		: '';

	const counts = state_counts(state.status.files);
	const staged = staged_file_count(state.status.files);

	const filter_status =
		state.visible_files.length !== state.status.files.length
			? ` • filtered ${state.visible_files.length}/${state.status.files.length}`
			: '';

	const text = `branch ${state.status.branch}${upstream} • ${state.status.files.length} files • staged ${staged}${filter_status}${counts ? ` • ${counts}` : ''}`;

	return new Text(state.theme.fg('muted', text), 0, 0).render(width);
}

function render_message(
	state: StageRenderState,
	width: number,
): string[] {
	let color: 'accent' | 'warning' | 'dim' = 'dim';

	if (state.busy) color = 'accent';
	else if (
		state.message.includes('disabled') ||
		state.message.includes('conflict') ||
		state.message.includes('blocked')
	)
		color = 'warning';

	return new Text(state.theme.fg(color, state.message), 0, 0).render(
		width,
	);
}

function render_action_menu(
	state: StageRenderState,
	width: number,
): string[] {
	const file = selected_file(state);

	const lines = [
		state.theme.bold('Actions'),
		state.theme.fg('muted', file?.path ?? 'No file selected'),
		'',
	];

	for (let index = 0; index < (state.actions?.length ?? 0); index++) {
		const action = state.actions![index]!;
		const prefix = index === state.selected_action ? '› ' : '  ';
		const line = `${prefix}${action.action_label.padEnd(18)} ${state.theme.fg('dim', action.action_description)}`;
		lines.push(
			index === state.selected_action
				? state.theme.fg('accent', state.theme.bold(line))
				: line,
		);
	}

	lines.push(
		'',
		state.theme.fg(
			'dim',
			'↑↓/jk move • enter run • ? help • esc cancel',
		),
	);

	return lines.flatMap((line) => new Text(line, 0, 0).render(width));
}

function render_help(
	state: StageRenderState,
	width: number,
): string[] {
	const groups = [
		[
			'Navigation',
			'↑↓/jk move files',
			'←→/hl scroll diff',
			'/ filter files',
			'r refresh',
		],
		[
			'Staging',
			'space safe toggle file',
			's stage file',
			'x unstage file',
			'S/X stage or unstage hunk',
			'+/- stage or unstage line',
			'a safe stage all',
			'A force stage all',
			'u unstage all',
			'discard file from actions menu',
		],
		['Diff selection', 'n/p move hunks', '[/] move changed lines'],
		[
			'Other',
			'enter actions',
			'c commit',
			'm amend commit',
			'g repository',
			'q/esc close',
		],
	];

	const lines = [
		state.theme.bold('Git UI help'),
		state.theme.fg('dim', '?/q/esc back'),
		'',
	];

	for (const [title, ...items] of groups) {
		lines.push(state.theme.fg('accent', state.theme.bold(title)));

		for (const item of items) lines.push(`  ${item}`);
		lines.push('');
	}

	return lines.flatMap((line) =>
		new Text(truncate_plain(line, width), 0, 0).render(width),
	);
}

function render_repo_overview(
	state: StageRenderState,
	width: number,
): string[] {
	const overview = state.repo_overview;

	if (!overview) return [];

	const lines = [
		state.theme.bold('Repository'),
		state.theme.fg('dim', 'q/esc back'),
		'',
		state.theme.fg('accent', state.theme.bold('Branches')),
		...render_section(overview.branches, 'No branches found'),
		'',
		state.theme.fg('accent', state.theme.bold('Recent commits')),
		...render_section(overview.log, 'No commits found'),
		'',
		state.theme.fg('accent', state.theme.bold('Stashes')),
		...render_section(overview.stashes, 'No stashes'),
		'',
		state.theme.fg('accent', state.theme.bold('Remotes')),
		...render_section(overview.remotes, 'No remotes'),
	];

	return lines.flatMap((line) =>
		new Text(truncate_plain(line, width), 0, 0).render(width),
	);
}

function render_workbench(
	state: StageRenderState,
	width: number,
): string[] {
	const gap = width >= 96 ? 3 : 1;

	const list_width = Math.min(
		42,
		Math.max(28, Math.floor(width * 0.42)),
	);

	const diff_width = Math.max(20, width - list_width - gap);
	const list = render_file_list(state, list_width);
	const diff = render_diff(state, diff_width, list.length);
	const height = Math.max(list.length, diff.length);
	const lines: string[] = [];

	for (let i = 0; i < height; i++) {
		const left = pad_ansi(list[i] ?? '', list_width);
		lines.push(`${left}${' '.repeat(gap)}${diff[i] ?? ''}`);
	}

	return lines;
}

function render_file_list(
	state: StageRenderState,
	width: number,
): string[] {
	const lines = [state.theme.bold('Files')];
	let last_state: FileState | undefined;

	for (let i = 0; i < state.visible_files.length; i++) {
		const file = state.visible_files[i]!;

		if (file.state !== last_state) {
			lines.push(
				state.theme.fg('dim', state_label(file.state).toUpperCase()),
			);
			last_state = file.state;
		}

		const selected = i === state.selected;
		const prefix = selected ? '› ' : '  ';
		const label_width = Math.max(8, width - 14);
		const label = truncate_plain(file.path, label_width);
		const meta = `${state_icon(file.state)} ${status_code(file)}`;
		const line = `${prefix}${pad_plain(label, label_width)} ${meta}`;
		lines.push(
			selected
				? state.theme.fg('accent', state.theme.bold(line))
				: line,
		);
	}

	return lines;
}

function render_diff(
	state: StageRenderState,
	width: number,
	height: number,
): string[] {
	const selected = selected_file(state);

	const title = selected
		? `Diff: ${truncate_plain(selected.path, Math.max(0, width - 6))}`
		: 'Diff';

	const lines = [state.theme.bold(title)];

	if (selected?.state === 'conflicted') {
		lines.push(
			state.theme.fg(
				'warning',
				'Conflict: resolve markers in your editor, then stage the file.',
			),
			'',
		);
	}

	if (!state.diff || state.diff.path !== state.diff_for_path) {
		lines.push(state.theme.fg('dim', 'Loading diff…'));

		return lines;
	}

	const visible = Math.max(1, height - 1);
	const max_scroll = Math.max(0, state.diff.lines.length - visible);
	const diff_scroll = Math.min(state.diff_scroll, max_scroll);

	const body = state.diff.lines.slice(
		diff_scroll,
		diff_scroll + visible,
	);

	for (let index = 0; index < body.length; index++) {
		const line_index = diff_scroll + index;
		const selected_hunk = state.diff.hunks[state.selected_hunk];
		lines.push(
			format_diff_line(
				state,
				body[index]!,
				width,
				selected_hunk?.line_index === line_index,
				state.selected_line_index === line_index,
			),
		);
	}

	if (max_scroll > 0) {
		lines[0] = `${lines[0]} ${state.theme.fg('dim', `${diff_scroll + 1}-${Math.min(diff_scroll + visible, state.diff.lines.length)}/${state.diff.lines.length}`)}`;
	}

	return lines;
}

function format_diff_line(
	state: StageRenderState,
	raw: string,
	width: number,
	selected_hunk = false,
	selected_line = false,
): string {
	let marker = '';

	if (selected_line) marker = '» ';
	else if (selected_hunk) marker = '› ';

	const text = truncate_plain(
		`${marker}${raw.replace(/\t/g, '  ')}`,
		width,
	);

	if (raw === 'STAGED' || raw === 'UNSTAGED') {
		return state.theme.fg('accent', state.theme.bold(text));
	}

	if (raw.startsWith('+++') || raw.startsWith('---'))
		return state.theme.fg('muted', text);

	if (raw.startsWith('@@')) return state.theme.fg('accent', text);

	if (raw.startsWith('+')) return state.theme.fg('success', text);

	if (raw.startsWith('-')) return state.theme.fg('warning', text);

	return text;
}

function selected_file(state: StageRenderState): GitFile | undefined {
	return state.visible_files[state.selected];
}

function render_section(
	items: string[],
	empty_text: string,
): string[] {
	if (items.length === 0) return [`  ${empty_text}`];

	return items.map((item) => `  ${item}`);
}
