import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import { show_modal } from '@spences10/pi-tui-modal';
import { GitStageBody } from './stage-body.js';

async function show_git_ui(
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== 'function') {
		ctx.ui.notify('Git UI requires interactive mode.', 'warning');

		return;
	}

	await show_modal<void>(
		ctx,
		{
			title: 'Source Control',
			subtitle:
				'Review diffs, safely stage files, and commit staged changes',
			footer: '↑↓/jk move • enter actions • ? help • q close',
			overlay_options: {
				width: '92%',
				minWidth: 80,
				maxHeight: '88%',
			},
			style: { border: 'rounded', border_color: 'accent' },
		},
		({ done }, theme, _layout, tui) => {
			const body = new GitStageBody(
				ctx.cwd,
				theme,
				() => tui.requestRender(),
				done,
			);

			void body.load();

			return body;
		},
	);
}

export default function git_ui_extension(pi: ExtensionAPI): void {
	pi.registerCommand('git-ui', {
		description: 'Open an interactive Git staging UI',
		handler: async (_args, ctx) => {
			await show_git_ui(ctx);
		},
	});
}
