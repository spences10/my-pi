import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { create_automatic_diagnostics } from './automatic-diagnostics.js';
import { register_lsp_command } from './commands.js';
import {
	LSP_SYSTEM_PROMPT,
	should_inject_lsp_prompt,
} from './prompt.js';
import {
	LspServerManager,
	type CreateLspServerManagerOptions,
} from './server-manager.js';
import { register_lsp_tools } from './tools.js';

export { should_inject_lsp_prompt } from './prompt.js';
export type { LspClientLike } from './server-manager.js';

export interface CreateLspExtensionOptions extends CreateLspServerManagerOptions {}

export function create_lsp_extension(
	options: CreateLspExtensionOptions = {},
) {
	return async function lsp(pi: ExtensionAPI) {
		const manager = new LspServerManager(options);

		register_lsp_tools(pi, manager);
		const automatic_diagnostics =
			create_automatic_diagnostics(manager);
		pi.on('tool_result', automatic_diagnostics.record_edit);
		pi.on('turn_end', automatic_diagnostics.flush);
		pi.on('session_start', automatic_diagnostics.reset);

		pi.on('before_agent_start', async (event) => {
			if (should_inject_lsp_prompt(event)) {
				event.systemPromptOptions.sections.lsp =
					LSP_SYSTEM_PROMPT.trim();
			} else {
				delete event.systemPromptOptions.sections.lsp;
			}
		});

		register_lsp_command(pi, manager);

		pi.on('session_shutdown', async () => {
			automatic_diagnostics.reset();
			await manager.clear_language_state();
		});
	};
}

export default create_lsp_extension();
