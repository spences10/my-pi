import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	is_text_content,
	scope_from_context,
	should_skip_tool,
	summarize_tool_input,
} from './context-scope.js';
import {
	get_context_store,
	maybe_store_context_output,
	set_context_sidecar_enabled,
	should_index_text,
} from './store.js';

export function register_context_lifecycle(pi: ExtensionAPI): void {
	set_context_sidecar_enabled(true, { project_path: process.cwd() });

	pi.on('session_start', async (_event, ctx) => {
		const scope = scope_from_context(ctx);
		set_context_sidecar_enabled(true, scope);
		get_context_store(scope).cleanup();
	});

	pi.on('session_shutdown', async () => {
		const store = get_context_store();
		const stats = store.stats();
		if (stats.purge_on_shutdown) store.cleanup();
		set_context_sidecar_enabled(false);
	});

	pi.on('tool_result', async (event, ctx) => {
		const tool_name = String(event.toolName ?? 'tool');
		if (should_skip_tool(tool_name)) return;
		if (!Array.isArray(event.content)) return;

		const text_items = event.content.filter(is_text_content);
		if (text_items.length === 0) return;
		const text = text_items.map((item) => item.text).join('\n');
		if (text.includes('[context-sidecar]')) return;
		if (!should_index_text(text)) return;

		try {
			const stored = maybe_store_context_output({
				text,
				tool_name,
				input_summary: summarize_tool_input(event.input),
				...scope_from_context(ctx),
			});
			if (!stored) return;
			return {
				content: [{ type: 'text' as const, text: stored.receipt }],
			};
		} catch {
			return;
		}
	});
}
