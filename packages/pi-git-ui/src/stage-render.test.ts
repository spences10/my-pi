import { describe, expect, it } from 'vitest';
import { render_stage } from './stage-render.js';
import type { StageRenderState } from './stage-types.js';

const theme: StageRenderState['theme'] = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const base_state: StageRenderState = {
	theme,
	status: {
		branch: 'main',
		ahead: 1,
		behind: 2,
		upstream: 'origin/main',
		files: [
			{
				path: 'src/a.ts',
				state: 'changed',
				index_status: ' ',
				worktree_status: 'M',
			},
			{
				path: 'src/b.ts',
				state: 'staged',
				index_status: 'M',
				worktree_status: ' ',
			},
		],
	},
	message: '',
	busy: false,
	visible_files: [
		{
			path: 'src/a.ts',
			state: 'changed',
			index_status: ' ',
			worktree_status: 'M',
		},
		{
			path: 'src/b.ts',
			state: 'staged',
			index_status: 'M',
			worktree_status: ' ',
		},
	],
	selected: 0,
	diff: {
		path: 'src/a.ts',
		lines: ['UNSTAGED', '@@ -1,1 +1,1 @@', '-old', '+new'],
		hunks: [
			{
				section: 'unstaged',
				line_index: 1,
				header: '@@ -1,1 +1,1 @@',
				patch: '@@ -1,1 +1,1 @@\n-old\n+new',
			},
		],
	},
	diff_for_path: 'src/a.ts',
	diff_scroll: 0,
	selected_hunk: 0,
	selected_line_index: 2,
	selected_action: 0,
	show_help: false,
};

describe('stage rendering', () => {
	it('renders the workbench header, files, and diff markers', () => {
		const output = render_stage(base_state, 100).join('\n');
		expect(output).toContain(
			'branch main • origin/main ↑1 ↓2 • 2 files • staged 1',
		);
		expect(output).toContain('Files');
		expect(output).toContain('Diff: src/a.ts');
		expect(output).toContain('» -old');
	});

	it('renders action, help, overview, loading, and conflict states', () => {
		expect(
			render_stage(
				{
					...base_state,
					actions: [
						{
							action_label: 'Stage',
							action_description: 'stage file',
							run: () => {},
						},
					],
				},
				80,
			).join('\n'),
		).toContain('Actions');
		expect(
			render_stage({ ...base_state, show_help: true }, 80).join('\n'),
		).toContain('Git UI help');
		expect(
			render_stage(
				{
					...base_state,
					repo_overview: {
						branches: ['main'],
						log: [],
						stashes: [],
						remotes: ['origin'],
					},
				},
				80,
			).join('\n'),
		).toContain('Repository');
		expect(
			render_stage({ ...base_state, diff: undefined }, 80).join('\n'),
		).toContain('Loading diff…');
		expect(
			render_stage(
				{
					...base_state,
					visible_files: [
						{
							path: 'conflict.ts',
							state: 'conflicted',
							index_status: 'U',
							worktree_status: 'U',
						},
					],
					selected: 0,
				},
				80,
			).join('\n'),
		).toContain('Conflict: resolve markers');
	});
});
