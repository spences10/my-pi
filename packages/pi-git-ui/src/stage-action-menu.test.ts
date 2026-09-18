import { describe, expect, it } from 'vite-plus/test';
import type { GitFile } from './git.js';
import {
	build_discard_confirmation,
	build_stage_actions,
	next_action_index,
	type StageActionMenuCallbacks,
} from './stage-action-menu.js';

function callbacks(): StageActionMenuCallbacks {
	return {
		stage_file() {},
		unstage_file() {},
		stage_hunk() {},
		unstage_hunk() {},
		stage_line() {},
		unstage_line() {},
		discard_file() {},
		commit() {},
		amend_commit() {},
		repository() {},
		refresh() {},
		conflict_help() {},
	};
}

const modified: GitFile = {
	path: 'src/a.ts',
	index_status: ' ',
	worktree_status: 'M',
	state: 'changed',
};
const conflicted: GitFile = {
	path: 'src/conflict.ts',
	index_status: 'U',
	worktree_status: 'U',
	state: 'conflicted',
};

describe('stage action menu helpers', () => {
	it('builds standard actions and prepends conflict help for conflicted files', () => {
		expect(
			build_stage_actions(modified, callbacks())[0]?.action_label,
		).toBe('stage file');
		expect(
			build_stage_actions(conflicted, callbacks())[0]?.action_label,
		).toBe('conflict help');
	});

	it('builds discard confirmation actions', () => {
		const actions = build_discard_confirmation(
			modified,
			() => {},
			() => {},
		);
		expect(actions.map((action) => action.action_label)).toEqual([
			'confirm discard',
			'cancel',
		]);
	});

	it('clamps action navigation', () => {
		expect(next_action_index(0, 3, '\x1B[A')).toBe(0);
		expect(next_action_index(1, 3, '\x1B[A')).toBe(0);
		expect(next_action_index(2, 3, '\x1B[B')).toBe(2);
		expect(next_action_index(1, 3, '\x1B[B')).toBe(2);
	});
});
