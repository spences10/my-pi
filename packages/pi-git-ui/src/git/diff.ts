import { git, git_with_input } from './client.js';
import { format_git_error } from './errors.js';
import { git_path } from './operations.js';
import type {
	DiffHunk,
	DiffSection,
	DiffView,
	GitFile,
} from './types.js';

export async function read_diff(
	cwd: string,
	file: GitFile,
): Promise<DiffView> {
	const path = git_path(file);

	if (file.state === 'untracked') {
		return {
			path: file.path,
			lines: [
				'Untracked file',
				'',
				'Press space or s to stage it.',
				'No diff is available until Git starts tracking the path.',
			],
			hunks: [],
		};
	}

	const lines: string[] = [];
	const hunks: DiffHunk[] = [];

	const staged = await git(
		['diff', '--cached', '--', path],
		cwd,
	).catch((error) => format_git_error(error));

	const unstaged = await git(['diff', '--', path], cwd).catch(
		(error) => format_git_error(error),
	);

	append_diff_section(lines, hunks, 'staged', staged);

	if (staged.trim() && unstaged.trim()) lines.push('', '');
	append_diff_section(lines, hunks, 'unstaged', unstaged);

	if (lines.length === 0)
		lines.push('No textual diff for this file.');

	return { path: file.path, lines, hunks };
}

function append_diff_section(
	lines: string[],
	hunks: DiffHunk[],
	section: DiffSection,
	raw: string,
): void {
	if (!raw.trim()) return;
	lines.push(section.toUpperCase(), '');
	const offset = lines.length;
	const parsed = parse_diff_hunks(raw, section);

	for (const hunk of parsed) {
		hunks.push({ ...hunk, line_index: offset + hunk.line_index });
	}

	lines.push(...raw.split('\n'));
}

export function parse_diff_hunks(
	raw: string,
	section: DiffSection,
): DiffHunk[] {
	const lines = raw.endsWith('\n')
		? raw.slice(0, -1).split('\n')
		: raw.split('\n');

	const hunks: DiffHunk[] = [];
	let file_header: string[] = [];
	let current_hunk: { start: number; lines: string[] } | undefined;

	const flush_hunk = (): void => {
		if (!current_hunk) return;
		hunks.push({
			section,
			line_index: current_hunk.start,
			header: current_hunk.lines[0] ?? '@@',
			patch: [...file_header, ...current_hunk.lines].join('\n'),
		});
		current_hunk = undefined;
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;

		if (line.startsWith('diff --git ')) {
			flush_hunk();
			file_header = [line];
			continue;
		}

		if (line.startsWith('@@')) {
			flush_hunk();
			current_hunk = { start: index, lines: [line] };
			continue;
		}

		if (current_hunk) current_hunk.lines.push(line);
		else if (file_header.length > 0) file_header.push(line);
	}

	flush_hunk();

	return hunks;
}

export function changed_line_indexes(hunk: DiffHunk): number[] {
	const lines = hunk.patch.split('\n');

	const header_index = lines.findIndex((line) =>
		line.startsWith('@@'),
	);

	if (header_index < 0) return [];

	return lines
		.slice(header_index + 1)
		.flatMap((line, index) =>
			(line.startsWith('+') || line.startsWith('-')) &&
			!line.startsWith('+++') &&
			!line.startsWith('---')
				? [hunk.line_index + 1 + index]
				: [],
		);
}

export async function stage_hunk(
	cwd: string,
	hunk: DiffHunk,
): Promise<void> {
	if (hunk.section !== 'unstaged')
		throw new Error('Selected hunk is already staged.');
	await git_with_input(
		['apply', '--cached', '--whitespace=nowarn', '-'],
		cwd,
		`${hunk.patch}\n`,
	);
}

export async function unstage_hunk(
	cwd: string,
	hunk: DiffHunk,
): Promise<void> {
	if (hunk.section !== 'staged')
		throw new Error('Selected hunk is not staged.');
	await git_with_input(
		['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
		cwd,
		`${hunk.patch}\n`,
	);
}

export async function stage_line(
	cwd: string,
	hunk: DiffHunk,
	line_index: number,
): Promise<void> {
	if (hunk.section !== 'unstaged')
		throw new Error('Selected line is already staged.');
	await git_with_input(
		['apply', '--cached', '--whitespace=nowarn', '-'],
		cwd,
		`${build_line_patch(hunk, line_index)}\n`,
	);
}

export async function unstage_line(
	cwd: string,
	hunk: DiffHunk,
	line_index: number,
): Promise<void> {
	if (hunk.section !== 'staged')
		throw new Error('Selected line is not staged.');
	await git_with_input(
		['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
		cwd,
		`${build_line_patch(hunk, line_index)}\n`,
	);
}

export function build_line_patch(
	hunk: DiffHunk,
	line_index: number,
): string {
	const lines = hunk.patch.split('\n');

	const header_index = lines.findIndex((line) =>
		line.startsWith('@@'),
	);

	if (header_index < 0)
		throw new Error('Selected hunk has no header.');
	const body_index = line_index - hunk.line_index - 1;
	const body = lines.slice(header_index + 1);
	const selected = body[body_index];

	if (
		!selected ||
		(!selected.startsWith('+') && !selected.startsWith('-'))
	) {
		throw new Error('Selected line is not stageable.');
	}

	const next_body = body.flatMap((line, index) => {
		if (index === body_index) return [line];

		if (line.startsWith('+')) return [];

		if (line.startsWith('-')) return [` ${line.slice(1)}`];

		return [line];
	});

	const header = rebuild_hunk_header(lines[header_index]!, next_body);

	return [...lines.slice(0, header_index), header, ...next_body].join(
		'\n',
	);
}

function rebuild_hunk_header(header: string, body: string[]): string {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(
		header,
	);

	if (!match) return header;
	let old_count = 0;
	let new_count = 0;

	for (const line of body) {
		if (line.startsWith('\\')) continue;

		if (!line.startsWith('+')) old_count++;

		if (!line.startsWith('-')) new_count++;
	}

	return `@@ -${match[1]},${old_count} +${match[2]},${new_count} @@${match[3]}`;
}
