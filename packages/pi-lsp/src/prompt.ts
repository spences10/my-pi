import type { BeforeAgentStartEvent } from '@earendil-works/pi-coding-agent';

export const LSP_TOOL_NAMES = new Set([
	'lsp_diagnostics',
	'lsp_diagnostics_many',
	'lsp_find_symbol',
	'lsp_hover',
	'lsp_definition',
	'lsp_references',
	'lsp_document_symbols',
]);

export const LSP_SYSTEM_PROMPT = `

## Language server support via LSP tools

You have access to Language Server Protocol tools for diagnostics, hover/type information, definitions, references, and document symbols. Use them when:
- Debugging TypeScript, JavaScript, Svelte, or other language-server-supported errors
- Checking types, symbol definitions, or API documentation from code
- Finding references more precisely than text search
- Validating focused code changes before reporting completion

LSP tools are available through codemode as tools.lsp_hover(), tools.lsp_definition(), tools.lsp_references(), tools.lsp_document_symbols(), tools.lsp_find_symbol(), tools.lsp_diagnostics(), and tools.lsp_diagnostics_many(). They can also be called directly when explicitly activated.

Successful edit/write calls, including those inside codemode, trigger a batched diagnostics report at turn end. Use that report instead of repeating the same validation. Bash edits are not tracked automatically.

After the final relevant edit, check changed language-server-supported files with LSP diagnostics before reporting completion. Prefer lsp_diagnostics_many for batches when automatic feedback is missing, incomplete, or no longer current. An incomplete result is not a pass.

Reuse passed diagnostics for review, commit, and push if file contents, dependencies, configuration, and relevant environment are unchanged. Rerun only affected or previously missing diagnostics, not because of a commit or push request alone.

Prefer LSP diagnostics over guessing from build output when a file-level check is enough. Use text search for broad discovery, then LSP tools for precise type and symbol questions.`;

export function should_inject_lsp_prompt(event: {
	systemPromptOptions?: Pick<
		BeforeAgentStartEvent['systemPromptOptions'],
		'selectedTools'
	>;
}): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;

	return (
		!selected_tools ||
		selected_tools.some(
			(tool) =>
				LSP_TOOL_NAMES.has(tool) ||
				tool === 'codemode' ||
				tool === 'tool_search',
		)
	);
}

export function append_lsp_system_prompt(
	system_prompt: string,
): string {
	return system_prompt + LSP_SYSTEM_PROMPT;
}
