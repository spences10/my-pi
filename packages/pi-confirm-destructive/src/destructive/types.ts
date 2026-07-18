export interface DestructiveAction {
	title: string;
	description: string;
	reason: string;
	allow_key: string;
}

export interface DestructiveCommandPattern {
	pattern: RegExp;
	reason: string;
	allow_key: string;
}

export type GitRecoverability =
	| 'tracked-clean'
	| 'tracked-dirty'
	| 'untracked'
	| 'ignored'
	| 'repo-root'
	| 'not-git';
