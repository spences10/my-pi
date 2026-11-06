import {
	isEditToolResult,
	isWriteToolResult,
	type ExtensionContext,
	type ToolResultEvent,
	type TurnEndEvent,
	type TurnEndEventResult,
} from '@earendil-works/pi-coding-agent';
import type { LspServerManager } from './server-manager.js';
import { detect_language } from './servers.js';
import { run_diagnostics_many } from './tools.js';

export function create_automatic_diagnostics(
	manager: LspServerManager,
) {
	const pending_files = new Set<string>();
	let generation = 0;

	function reset(): void {
		pending_files.clear();
		generation += 1;
	}

	function record_edit(event: ToolResultEvent): void {
		if (
			event.isError ||
			(!isEditToolResult(event) && !isWriteToolResult(event))
		)
			return;
		const path = event.input.path;
		if (typeof path !== 'string' || !detect_language(path)) return;
		pending_files.add(manager.resolve_abs(path));
	}

	async function flush(
		event: TurnEndEvent,
		ctx: ExtensionContext,
	): Promise<TurnEndEventResult | undefined> {
		if (event.outcome !== 'completed' || ctx.signal?.aborted) {
			reset();
			return;
		}
		const files = Array.from(pending_files);
		pending_files.clear();
		if (files.length === 0) return;
		const current_generation = generation;
		const result = await run_diagnostics_many(
			manager,
			files,
			1500,
			ctx,
			ctx.signal,
		);
		if (current_generation !== generation || ctx.signal?.aborted)
			return;
		return {
			entries: [
				...event.entries,
				{
					type: 'custom_message',
					customType: 'lsp-diagnostics',
					content:
						'Automatic LSP diagnostics after edits:\n\n' +
						result.content.map((block) => block.text).join('\n'),
					display: true,
					details: { files, result: result.details },
				},
			],
			continue: true,
		};
	}

	return { record_edit, flush, reset };
}
