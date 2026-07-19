import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import omnisearch from './index.js';

type PromptEvent = {
	systemPrompt: string;
	systemPromptOptions?: { selectedTools?: string[] };
};
type PromptHandler = (
	event: PromptEvent,
) => Promise<Record<string, unknown>>;

async function register_prompt_handler(): Promise<PromptHandler> {
	const on = vi.fn();
	await omnisearch({ on } as unknown as ExtensionAPI);
	expect(on).toHaveBeenCalledWith(
		'before_agent_start',
		expect.any(Function),
	);
	return on.mock.calls[0]?.[1] as PromptHandler;
}

describe('omnisearch extension', () => {
	it('injects guidance when selected tools are unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({ systemPrompt: 'base', systemPromptOptions: {} }),
		).resolves.toEqual({
			systemPrompt: expect.stringMatching(
				/^base\n\n## Web research via mcp-omnisearch/,
			),
		});
	});

	it('injects guidance when mcp-omnisearch is active', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__mcp-omnisearch__web_search'],
				},
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Web research via mcp-omnisearch',
			),
		});
	});

	it('injects for Omnisearch MCP tools when the server is aliased', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools: ['mcp__omnisearch__web_extract'],
				},
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Web research via mcp-omnisearch',
			),
		});
	});

	it('skips guidance when Omnisearch MCP tools are unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			}),
		).resolves.toEqual({});
	});

	it('skips similarly named tools from non-Omnisearch MCP servers', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools: ['mcp__search__web_search'],
				},
			}),
		).resolves.toEqual({});
	});
});
