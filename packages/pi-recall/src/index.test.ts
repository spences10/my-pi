import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import recall, { should_inject_recall_prompt } from './index.js';

describe('should_inject_recall_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_recall_prompt({
				systemPromptOptions: {},
			} as Parameters<typeof should_inject_recall_prompt>[0]),
		).toBe(true);
	});

	it('injects when bash is active', () => {
		expect(
			should_inject_recall_prompt({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as Parameters<typeof should_inject_recall_prompt>[0]),
		).toBe(true);
	});

	it('skips injection when bash is unavailable', () => {
		expect(
			should_inject_recall_prompt({
				systemPromptOptions: { selectedTools: ['read', 'write'] },
			} as Parameters<typeof should_inject_recall_prompt>[0]),
		).toBe(false);
	});

	it('registers lifecycle and prompt hooks', async () => {
		const handlers = new Map<string, Function>();
		const on = vi.fn((name: string, handler: Function) => {
			handlers.set(name, handler);
		});
		await recall({ on } as unknown as ExtensionAPI);
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
		await expect(
			handlers.get('before_agent_start')?.({
				systemPrompt: 'base',
				systemPromptOptions: {},
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining('Session Recall'),
		});
	});
});
