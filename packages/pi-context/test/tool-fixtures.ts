import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionHandler,
	ExtensionToolContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolDefinition,
	ToolResultEvent,
	ToolResultEventResult,
} from '@earendil-works/pi-coding-agent';
import { vi } from 'vite-plus/test';
import {
	make_api,
	make_tool_context,
	type ContextOverrides,
} from '../../../tools/test-sdk.js';

type ToolContextOverrides = Pick<
	ContextOverrides,
	'cwd' | 'sessionManager'
>;

type ToolResultHook = ExtensionHandler<
	ToolResultEvent,
	ToolResultEventResult
>;

type ToolResultOverrides = Partial<
	Omit<ToolResultEvent, 'toolName' | 'details'>
> & {
	toolName?: string;
	details?: unknown;
};

function resolve_tool_context(
	context: ExtensionToolContext,
	ctx?: ToolContextOverrides,
): ExtensionToolContext {
	if (!ctx) return context;

	return make_tool_context({
		cwd: ctx.cwd ?? context.cwd,
		sessionManager: {
			getSessionId: () => context.sessionManager.getSessionId(),
			getSessionFile: () => context.sessionManager.getSessionFile(),
			...ctx.sessionManager,
		},
	});
}

function wrap_tool(
	tool: ToolDefinition,
	context: ExtensionToolContext,
) {
	return {
		...tool,
		context,
		execute<T>(
			id: string,
			params: T,
			signal?: AbortSignal,
			on_update?: Parameters<ToolDefinition['execute']>[3],
			ctx?: ToolContextOverrides,
		) {
			return tool.execute(
				id,
				params,
				signal,
				on_update,
				resolve_tool_context(context, ctx),
			);
		},
	};
}

export function capture_tool(register: (pi: ExtensionAPI) => void) {
	const pi = make_api();
	const register_tool = vi.spyOn(pi, 'registerTool');
	register(pi);
	const tool = register_tool.mock.calls[0]?.[0];

	if (!tool) throw new Error('Expected a registered context tool');

	return wrap_tool(tool, make_tool_context({ cwd: process.cwd() }));
}

export function tool_result_event(
	overrides: ToolResultOverrides = {},
): ToolResultEvent {
	return {
		type: 'tool_result',
		toolCallId: 'call',
		toolName: 'tool',
		input: {},
		content: [],
		isError: false,
		details: undefined,
		...overrides,
	};
}

/** Registers an extension against a fixture API and exposes what it registered. */
export function capture_extension(
	register: (pi: ExtensionAPI) => void,
) {
	const hooks = new Map<string, Function[]>();

	const pi = make_api({
		on(name: string, handler: Function) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler]);

			return () => {
				hooks.set(
					name,
					(hooks.get(name) ?? []).filter(
						(value) => value !== handler,
					),
				);
			};
		},
	});

	const register_tool = vi.spyOn(pi, 'registerTool');
	const register_command = vi.spyOn(pi, 'registerCommand');
	register(pi);

	const context = make_tool_context({ cwd: process.cwd() });

	const tools = new Map(
		register_tool.mock.calls.map(([tool]) => [
			tool.name,
			wrap_tool(tool, context),
		]),
	);

	const commands = new Map(
		register_command.mock.calls.map(([name, command]) => [
			name,
			command,
		]),
	);

	function first_hook(name: string): Function {
		const hook = hooks.get(name)?.[0];

		if (!hook) throw new Error(`Expected a registered ${name} hook`);

		return hook;
	}

	return {
		pi,
		tools,
		commands,
		hook_count: (name: string) => hooks.get(name)?.length ?? 0,
		async tool_result(
			event: ToolResultEvent,
			ctx?: ToolContextOverrides,
		) {
			// SAFETY: `pi.on('tool_result', ...)` accepts only handlers with this signature.
			const hook = first_hook('tool_result') as ToolResultHook;

			return hook(event, resolve_tool_context(context, ctx));
		},
		async session_start(ctx?: ToolContextOverrides) {
			// SAFETY: `pi.on('session_start', ...)` accepts only handlers with this signature.
			const hook = first_hook(
				'session_start',
			) as ExtensionHandler<SessionStartEvent>;

			await hook(
				{ type: 'session_start', reason: 'startup' },
				resolve_tool_context(context, ctx),
			);
		},
		async session_shutdown() {
			// SAFETY: `pi.on('session_shutdown', ...)` accepts only handlers with this signature.
			const hook = first_hook(
				'session_shutdown',
			) as ExtensionHandler<SessionShutdownEvent>;

			await hook(
				{ type: 'session_shutdown', reason: 'quit' },
				context,
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

export function hook_text(
	result: Awaited<ReturnType<ToolResultHook>>,
): string {
	const content = result?.content?.[0];

	if (content?.type !== 'text')
		throw new Error('Expected a text tool_result replacement');

	return content.text;
}
