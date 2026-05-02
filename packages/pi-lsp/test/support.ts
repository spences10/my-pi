import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { rmSync } from 'node:fs';
import { afterEach, vi } from 'vitest';
import type { LspClientLike } from '../src/index.js';

export function create_mock_client(
	overrides: Partial<LspClientLike> = {},
): LspClientLike {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		is_ready: vi.fn().mockReturnValue(true),
		ensure_document_open: vi.fn().mockResolvedValue(undefined),
		hover: vi.fn().mockResolvedValue(null),
		definition: vi.fn().mockResolvedValue([]),
		references: vi.fn().mockResolvedValue([]),
		document_symbols: vi.fn().mockResolvedValue([]),
		wait_for_diagnostics: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

export function create_test_pi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any>();

	const pi = {
		registerTool(definition: any) {
			tools.set(definition.name, definition);
		},
		registerCommand(name: string, definition: any) {
			commands.set(name, definition);
		},
		on(name: string, handler: any) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;

	return { pi, tools, commands, events };
}

export const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

export function create_command_context(
	modal_results: unknown[] = [],
) {
	const notifications: Array<{ message: string; level?: string }> =
		[];
	const selections: string[] = [];
	return {
		ctx: {
			hasUI: true,
			ui: {
				notify(message: string, level?: string) {
					notifications.push({ message, level });
				},
				select: vi.fn(async () => selections.shift()),
				custom: modal_results.length
					? vi.fn(async (create_component: any) => {
							create_component(
								{ requestRender: vi.fn() },
								{
									fg: (_color: string, text: string) => text,
									bold: (text: string) => text,
								},
								{},
								vi.fn(),
							);
							return modal_results.shift();
						})
					: undefined,
			},
		} as any,
		notifications,
		selections,
	};
}

export function create_deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
