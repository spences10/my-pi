import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import nopeek, * as nopeek_entrypoint from './index.js';

type PromptEvent = {
	systemPrompt: string;
	systemPromptOptions?: { selectedTools?: string[] };
};
type PromptHandler = (
	event: PromptEvent,
) => Promise<Record<string, unknown>>;

async function register_prompt_handler(): Promise<PromptHandler> {
	const on = vi.fn();
	await nopeek({ on } as unknown as ExtensionAPI);
	expect(on).toHaveBeenCalledWith(
		'before_agent_start',
		expect.any(Function),
	);
	return on.mock.calls[0]?.[1] as PromptHandler;
}

describe('nopeek extension', () => {
	it('preserves the published prompt guard named export', () => {
		expect(nopeek_entrypoint.should_inject_nopeek_prompt).toBeTypeOf(
			'function',
		);
	});

	it('injects guidance when selected tools are unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({ systemPrompt: 'base', systemPromptOptions: {} }),
		).resolves.toEqual({
			systemPrompt: expect.stringMatching(
				/^base\n\n## Secret-safe environment loading via nopeek/,
			),
		});
	});

	it('injects guidance when bash is active', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Secret-safe environment loading via nopeek',
			),
		});
	});

	it('skips guidance when bash is unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read', 'write'] },
			}),
		).resolves.toEqual({});
	});
});
