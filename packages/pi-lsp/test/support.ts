import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import { rmSync } from 'node:fs';
import { afterEach, vi } from 'vitest';
import {
	create_lsp_extension,
	type CreateLspExtensionOptions,
	type LspClientLike,
} from '../src/index.js';

export function create_mock_client(
	overrides: Partial<LspClientLike> = {},
): LspClientLike {
	return {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		is_ready: vi.fn().mockReturnValue(true),
		ensure_document_open: vi.fn().mockResolvedValue(undefined),
		close_document: vi.fn().mockResolvedValue(undefined),
		open_document_count: vi.fn().mockReturnValue(0),
		hover: vi.fn().mockResolvedValue(null),
		definition: vi.fn().mockResolvedValue([]),
		references: vi.fn().mockResolvedValue([]),
		document_symbols: vi.fn().mockResolvedValue([]),
		wait_for_diagnostics: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

class RequiredMap<K, V> extends Map<K, V> {
	override get(key: K): V {
		const value = super.get(key);
		if (value === undefined)
			throw new Error(`Missing test key: ${String(key)}`);
		return value;
	}
}

export function create_test_pi() {
	const tools = new RequiredMap<
		string,
		{ name: string; execute: Function }
	>();
	const commands = new RequiredMap<string, { handler: Function }>();
	const events = new RequiredMap<string, Function>();

	const pi = {
		registerTool(definition: { name: string; execute: Function }) {
			tools.set(definition.name, definition);
		},
		registerCommand(name: string, definition: { handler: Function }) {
			commands.set(name, definition);
		},
		on(name: string, handler: Function) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;

	return { pi, tools, commands, events };
}

export async function register_test_lsp_extension(
	pi: ExtensionAPI,
	options: CreateLspExtensionOptions = {},
) {
	await create_lsp_extension(options)(pi);
}

export async function create_test_lsp_extension(
	options: CreateLspExtensionOptions = {},
) {
	const test_pi = create_test_pi();
	await register_test_lsp_extension(test_pi.pi, options);
	return test_pi;
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
			mode: 'tui',
			hasUI: true,
			ui: {
				notify(message: string, level?: string) {
					notifications.push({ message, level });
				},
				select: vi.fn(async () => selections.shift()),
				custom: modal_results.length
					? vi.fn(async (create_component: Function) => {
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
		} as unknown as ExtensionCommandContext,
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
