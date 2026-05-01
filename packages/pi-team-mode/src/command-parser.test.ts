import { describe, expect, it } from 'vitest';
import {
	parse_spawn_request,
	parse_task_add,
	profile_prompt,
} from './command-parser.js';

describe('team command parsing', () => {
	it('parses assigned task creation shorthand', () => {
		expect(parse_task_add('alice: inspect the tests')).toEqual({
			assignee: 'alice',
			title: 'inspect the tests',
		});
		expect(parse_task_add('inspect the tests')).toEqual({
			title: 'inspect the tests',
		});
	});

	it('parses spawn flags before prompt text', () => {
		expect(
			parse_spawn_request([
				'alice',
				'--worktree',
				'--mutating',
				'--branch',
				'team/alice',
				'--worktree-path',
				'../alice',
				'--profile',
				'reviewer',
				'claim work',
			]),
		).toEqual({
			member: 'alice',
			workspace_mode: 'worktree',
			mutating: true,
			branch: 'team/alice',
			worktree_path: '../alice',
			profile: 'reviewer',
			prompt: 'claim work',
		});
	});

	it('requires spawn flag values', () => {
		expect(() => parse_spawn_request(['alice', '--branch'])).toThrow(
			/branch is required/,
		);
	});

	it('prefers explicit prompts over profile prompts', () => {
		const profile = {
			name: 'reviewer',
			prompt: 'from profile',
			source: 'user' as const,
			path: '/profiles/reviewer.json',
		};
		expect(profile_prompt(profile, 'go')).toBe('go');
		expect(profile_prompt(profile, '')).toBe('from profile');
	});
});
