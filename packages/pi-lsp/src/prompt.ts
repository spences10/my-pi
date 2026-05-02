import type { BeforeAgentStartEvent } from '@mariozechner/pi-coding-agent';

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

After editing language-server-supported files, check changed files with LSP diagnostics before reporting completion or committing. Prefer lsp_diagnostics_many for batches: use git to identify changed files, filter to supported source files, then run diagnostics on that list.

Prefer LSP diagnostics over guessing from build output when a file-level check is enough. Use text search for broad discovery, then LSP tools for precise type and symbol questions.`;

export function should_inject_lsp_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools ||
		selected_tools.some((tool) => LSP_TOOL_NAMES.has(tool))
	);
}

export function append_lsp_system_prompt(
	system_prompt: string,
): string {
	return system_prompt + LSP_SYSTEM_PROMPT;
}
