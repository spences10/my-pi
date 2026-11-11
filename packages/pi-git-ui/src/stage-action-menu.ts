import type { GitFile } from './git.js';
import { key_is_down, key_is_up } from './render.js';
import type { ActionItem } from './stage-types.js';

export interface StageActionMenuCallbacks {
	stage_file(): void;
	unstage_file(): void;
	stage_hunk(): void;
	unstage_hunk(): void;
	stage_line(): void;
	unstage_line(): void;
	discard_file(file: GitFile): void;
	commit(): void;
	amend_commit(): void;
	repository(): void;
	refresh(path: string): void;
	conflict_help(file: GitFile): void;
}

export function build_stage_actions(
	file: GitFile,
	callbacks: StageActionMenuCallbacks,
): ActionItem[] {
	const actions: ActionItem[] = [
		{
			action_label: 'stage file',
			action_description: 'Stage all worktree changes for this file',
			run: () => callbacks.stage_file(),
		},
		{
			action_label: 'unstage file',
			action_description: 'Remove this file from the index',
			run: () => callbacks.unstage_file(),
		},
		{
			action_label: 'stage hunk',
			action_description: 'Stage the selected unstaged hunk',
			run: () => callbacks.stage_hunk(),
		},
		{
			action_label: 'unstage hunk',
			action_description: 'Unstage the selected staged hunk',
			run: () => callbacks.unstage_hunk(),
		},
		{
			action_label: 'stage line',
			action_description: 'Stage the selected changed line',
			run: () => callbacks.stage_line(),
		},
		{
			action_label: 'unstage line',
			action_description: 'Unstage the selected changed line',
			run: () => callbacks.unstage_line(),
		},
		{
			action_label: 'discard file',
			action_description:
				'Discard unstaged worktree changes for this file',
			run: () => callbacks.discard_file(file),
		},
		{
			action_label: 'commit',
			action_description: 'Commit currently staged changes',
			run: () => callbacks.commit(),
		},
		{
			action_label: 'amend commit',
			action_description: 'Amend HEAD with staged changes',
			run: () => callbacks.amend_commit(),
		},
		{
			action_label: 'repository',
			action_description: 'Show branches, log, stashes, and remotes',
			run: () => callbacks.repository(),
		},
		{
			action_label: 'refresh',
			action_description: 'Reload git status and diff',
			run: () => callbacks.refresh(file.path),
		},
	];

	if (file.state === 'conflicted') {
		actions.unshift({
			action_label: 'conflict help',
			action_description: 'Show safe conflict resolution steps',
			run: () => callbacks.conflict_help(file),
		});
	}

	return actions;
}

export function build_discard_confirmation(
	file: GitFile,
	on_confirm: (file: GitFile) => void,
	on_cancel: () => void,
): ActionItem[] {
	return [
		{
			action_label: 'confirm discard',
			action_description:
				'Permanently remove unstaged worktree changes',
			run: () => on_confirm(file),
		},
		{
			action_label: 'cancel',
			action_description: 'Keep changes',
			run: on_cancel,
		},
	];
}

export function next_action_index(
	current: number,
	length: number,
	input: string,
): number {
	if (key_is_up(input)) return Math.max(0, current - 1);

	if (key_is_down(input)) return Math.min(length - 1, current + 1);

	return current;
}
