import { describe, expect, it } from 'vite-plus/test';
import type { GitFile } from './git.js';
import {
	key_is_down,
	key_is_up,
	pad_ansi,
	pad_plain,
	state_counts,
	state_icon,
	state_label,
	status_code,
	strip_ansi,
	truncate_plain,
} from './render.js';

const file = (
	state: GitFile['state'],
	index_status = ' ',
	worktree_status = 'M',
	path = `${state}.txt`,
): GitFile => ({
	path,
	state,
	index_status,
	worktree_status,
});

describe('git UI render helpers', () => {
	it('formats states, status codes, and counts', () => {
		expect(state_label('mixed')).toBe('partial');
		expect(state_icon('conflicted')).toBe('!');
		expect(status_code(file('changed', ' ', 'M'))).toBe('·M');
		expect(
			state_counts([
				file('staged', 'M', ' '),
				file('changed'),
				file('changed', ' ', 'D'),
				file('untracked', '?', '?'),
			]),
		).toBe('changed 2 • untracked 1 • staged 1');
	});

	it('handles navigation keys and plain/ansi string sizing', () => {
		expect(key_is_up('k')).toBe(true);
		expect(key_is_up('\x1B[A')).toBe(true);
		expect(key_is_down('j')).toBe(true);
		expect(key_is_down('\x1B[B')).toBe(true);
		expect(strip_ansi('\x1B[31mred\x1B[0m')).toBe('red');
		expect(truncate_plain('abcdef', 4)).toBe('abc…');
		expect(truncate_plain('abcdef', 0)).toBe('');
		expect(pad_plain('x', 3)).toBe('x  ');
		expect(pad_ansi('\x1B[31mx\x1B[0m', 3)).toBe(
			'\x1B[31mx\x1B[0m  ',
		);
	});
});
