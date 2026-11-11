import type { FileState, GitFile } from './git.js';

export function state_label(state: FileState): string {
	switch (state) {
		case 'staged':
			return 'staged';
		case 'mixed':
			return 'partial';
		case 'untracked':
			return 'untracked';
		case 'conflicted':
			return 'conflict';
		case 'changed':
			return 'changed';
	}
}

export function state_icon(state: FileState): string {
	switch (state) {
		case 'conflicted':
			return '!';
		case 'changed':
			return '±';
		case 'untracked':
			return '?';
		case 'mixed':
			return '◐';
		case 'staged':
			return '✓';
	}
}

export function status_code(file: GitFile): string {
	const index = file.index_status === ' ' ? '·' : file.index_status;

	const worktree =
		file.worktree_status === ' ' ? '·' : file.worktree_status;

	return `${index}${worktree}`;
}

export function state_counts(files: GitFile[]): string {
	const counts = new Map<FileState, number>();

	for (const file of files)
		counts.set(file.state, (counts.get(file.state) ?? 0) + 1);

	return (
		['conflicted', 'changed', 'untracked', 'mixed', 'staged'] as const
	)
		.filter((state) => counts.has(state))
		.map((state) => `${state_label(state)} ${counts.get(state)}`)
		.join(' • ');
}

export function key_is_up(data: string): boolean {
	return data === 'k' || data === '\x1B[A';
}

export function key_is_down(data: string): boolean {
	return data === 'j' || data === '\x1B[B';
}

export function strip_ansi(text: string): string {
	const escape = String.fromCharCode(27);
	let output = '';

	for (let i = 0; i < text.length; i++) {
		if (text[i] !== escape) {
			output += text[i];
			continue;
		}

		if (text[i + 1] !== '[') continue;
		i += 2;

		while (i < text.length && !is_ansi_final_byte(text.charCodeAt(i)))
			i++;
	}

	return output;
}

function is_ansi_final_byte(code: number): boolean {
	return code >= 0x40 && code <= 0x7e;
}

export function truncate_plain(text: string, width: number): string {
	if (width <= 0) return '';

	if (text.length <= width) return text;

	return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function pad_plain(text: string, width: number): string {
	return text + ' '.repeat(Math.max(0, width - text.length));
}

export function pad_ansi(text: string, width: number): string {
	return (
		text + ' '.repeat(Math.max(0, width - strip_ansi(text).length))
	);
}
