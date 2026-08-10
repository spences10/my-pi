import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import prompt_presets from './index.js';

describe('prompt presets runtime', () => {
	it('appends the selected preset to the system prompt sent to the model', async () => {
		type Handler = (...args: unknown[]) => Promise<unknown>;
		const handlers = new Map<string, Handler>();
		const pi = {
			appendEntry: vi.fn(),
			getFlag: vi.fn(() => 'asd-ste100'),
			on: vi.fn((event: string, handler: Handler) => {
				handlers.set(event, handler);
			}),
			registerCommand: vi.fn(),
			registerFlag: vi.fn(),
		} as unknown as ExtensionAPI;
		const ctx = {
			cwd: process.cwd(),
			sessionManager: { getEntries: () => [] },
			ui: { setStatus: vi.fn() },
		};

		await prompt_presets(pi);
		await handlers.get('session_start')?.({}, ctx);
		const result = await handlers.get('before_agent_start')?.({
			systemPrompt: 'Pi system prompt',
		});

		expect(result).toEqual({
			systemPrompt: expect.stringContaining(
				'## Active Prompt Layers\n\n### asd-ste100\nUse ASD-STE100 Simplified Technical English in all replies.',
			),
		});
		expect((result as { systemPrompt: string }).systemPrompt).toMatch(
			/^Pi system prompt\n\n/,
		);
	});
});
