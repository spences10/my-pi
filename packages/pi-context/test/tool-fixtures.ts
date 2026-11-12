import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { vi } from 'vite-plus/test';
import {
	make_api,
	make_tool_context,
	type ContextOverrides,
} from '../../../tools/test-sdk.js';

export function capture_tool(register: (pi: ExtensionAPI) => void) {
	const pi = make_api();
	const register_tool = vi.spyOn(pi, 'registerTool');
	register(pi);
	const tool = register_tool.mock.calls[0]?.[0];

	if (!tool) throw new Error('Expected a registered context tool');

	const context = make_tool_context({ cwd: process.cwd() });

	return {
		...tool,
		context,
		execute<T>(
			id: string,
			params: T,
			signal?: AbortSignal,
			on_update?: Parameters<ToolDefinition['execute']>[3],
			ctx?: Pick<ContextOverrides, 'cwd' | 'sessionManager'>,
		) {
			const call_context = ctx
				? make_tool_context({
						cwd: ctx.cwd ?? context.cwd,
						sessionManager: {
							getSessionId: () =>
								context.sessionManager.getSessionId(),
							getSessionFile: () =>
								context.sessionManager.getSessionFile(),
							...ctx.sessionManager,
						},
					})
				: context;

			return tool.execute(
				id,
				params,
				signal,
				on_update,
				call_context,
			);
		},
	};
}

export function tool_text(
	result: Pick<AgentToolResult<unknown>, 'content'>,
): string {
	const content = result.content[0];

	if (content?.type !== 'text')
		throw new Error('Expected a context tool text result');

	return content.text;
}
