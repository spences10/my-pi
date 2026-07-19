import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import recall from './index.js';

type PromptEvent = {
	systemPrompt: string;
	systemPromptOptions?: { selectedTools?: string[] };
};
type PromptHandler = (
	event: PromptEvent,
) => Promise<Record<string, unknown>>;

async function register_extension() {
	const handlers = new Map<string, Function>();
	const on = vi.fn((name: string, handler: Function) => {
		handlers.set(name, handler);
	});
	const register_command = vi.fn();
	await recall({
		on,
		registerCommand: register_command,
	} as unknown as ExtensionAPI);
	return { handlers, on, register_command };
}

describe('recall extension', () => {
	it('registers recall commands and lifecycle hooks', async () => {
		const { handlers, on, register_command } =
			await register_extension();
		expect(register_command).toHaveBeenCalledWith(
			'resume-recall',
			expect.objectContaining({
				description: expect.any(String),
				handler: expect.any(Function),
			}),
		);
		expect(register_command).toHaveBeenCalledTimes(1);
		expect(on).toHaveBeenCalledWith(
			'session_start',
			expect.any(Function),
		);
		expect(on).toHaveBeenCalledWith(
			'session_shutdown',
			expect.any(Function),
		);
		expect(on).toHaveBeenCalledWith(
			'before_agent_start',
			expect.any(Function),
		);
		await expect(
			handlers.get('session_start')?.(),
		).resolves.toBeUndefined();
		await expect(
			handlers.get('session_shutdown')?.(),
		).resolves.toBeUndefined();
	});

	it('injects guidance when selected tools are unavailable', async () => {
		const { handlers } = await register_extension();
		const handler = handlers.get(
			'before_agent_start',
		) as PromptHandler;
		await expect(
			handler({ systemPrompt: 'base', systemPromptOptions: {} }),
		).resolves.toEqual({
			systemPrompt: expect.stringMatching(
				/^base\n\n## Session Recall/,
			),
		});
	});

	it('injects guidance when bash is active', async () => {
		const { handlers } = await register_extension();
		const handler = handlers.get(
			'before_agent_start',
		) as PromptHandler;
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools: ['read', 'bash'],
				},
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining('Session Recall'),
		});
	});

	it('skips guidance when bash is unavailable', async () => {
		const { handlers } = await register_extension();
		const handler = handlers.get(
			'before_agent_start',
		) as PromptHandler;
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools: ['read', 'write'],
				},
			}),
		).resolves.toEqual({});
	});
});
