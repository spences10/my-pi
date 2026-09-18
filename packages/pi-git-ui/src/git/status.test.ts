import { describe, expect, it } from 'vite-plus/test';
import {
	has_staged_changes,
	parse_porcelain_z,
	staged_file_count,
} from './status.js';

describe('git status parsing', () => {
	it('parses, classifies, renames, and sorts porcelain -z output', () => {
		const files = parse_porcelain_z(
			[
				'?? untracked.txt',
				' M changed.txt',
				'M  staged.txt',
				'MM mixed.txt',
				'UU conflict.txt',
				'R  new-name.txt',
				'old-name.txt',
				'',
			].join('\0'),
		);

		expect(files.map((file) => [file.path, file.state])).toEqual([
			['conflict.txt', 'conflicted'],
			['changed.txt', 'changed'],
			['untracked.txt', 'untracked'],
			['mixed.txt', 'mixed'],
			['old-name.txt → new-name.txt', 'staged'],
			['staged.txt', 'staged'],
		]);
		expect(has_staged_changes(files)).toBe(true);
		expect(staged_file_count(files)).toBe(4);
	});

	it('handles empty status', () => {
		expect(parse_porcelain_z('')).toEqual([]);
		expect(has_staged_changes([])).toBe(false);
		expect(staged_file_count([])).toBe(0);
	});
});
