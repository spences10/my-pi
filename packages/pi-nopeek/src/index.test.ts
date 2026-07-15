import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import nopeek, { should_inject_nopeek_prompt } from './index.js';

describe('should_inject_nopeek_prompt', () => {
	it('injects when selected tools are unavailable', () => {
		expect(
			should_inject_nopeek_prompt({
				systemPromptOptions: {},
			} as Parameters<typeof should_inject_nopeek_prompt>[0]),
		).toBe(true);
	});

	it('injects when bash is active', () => {
		expect(
			should_inject_nopeek_prompt({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as Parameters<typeof should_inject_nopeek_prompt>[0]),
		).toBe(true);
	});

	it('skips injection when bash is unavailable', () => {
		expect(
			should_inject_nopeek_prompt({
				systemPromptOptions: { selectedTools: ['read', 'write'] },
			} as Parameters<typeof should_inject_nopeek_prompt>[0]),
		).toBe(false);
	});

	it('registers a before_agent_start hook that appends guidance', async () => {
		const on = vi.fn();
		await nopeek({ on } as unknown as ExtensionAPI);
		const handler = on.mock.calls[0]?.[1];
		await expect(
			handler({ systemPrompt: 'base', systemPromptOptions: {} }),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Secret-safe environment loading via nopeek',
			),
		});
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read'] },
			}),
		).resolves.toEqual({});
	});
});
