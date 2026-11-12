import type { BuildSystemPromptOptions } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vite-plus/test';
import {
	create_mock_client,
	create_test_lsp_extension,
} from '../test/support.js';
import { should_inject_lsp_prompt } from './index.js';

describe('lsp prompt guidance', () => {
	it.each(['lsp_diagnostics', 'codemode', 'tool_search'])(
		'injects LSP workflow guidance when %s is active',
		async (tool) => {
			const { events } = await create_test_lsp_extension({
				create_client: () => create_mock_client(),
				read_file: async () => 'export const value = 1;\n',
				cwd: () => '/repo',
			});

			const sections: NonNullable<
				BuildSystemPromptOptions['sections']
			> = { unrelated: 'keep' };

			const event = {
				systemPrompt: 'base prompt',
				systemPromptOptions: {
					selectedTools: [tool],
					sections,
				},
			};

			expect(
				await events.get('before_agent_start')(event),
			).toBeUndefined();
			expect(event.systemPrompt).toBe('base prompt');
			expect(event.systemPromptOptions.sections.unrelated).toBe(
				'keep',
			);

			for (const text of [
				'Language server support via LSP tools',
				'tools.lsp_hover()',
				'Successful edit/write calls',
				'Use that report instead of repeating the same validation.',
				'check changed language-server-supported files with LSP diagnostics before reporting completion',
				'Prefer LSP diagnostics over guessing from build output',
				'Rerun only affected or previously missing diagnostics, not because of a commit or push request alone.',
			])
				expect(event.systemPromptOptions.sections.lsp).toContain(
					text,
				);
			event.systemPromptOptions.selectedTools = ['read'];
			await events.get('before_agent_start')(event);
			expect(event.systemPromptOptions.sections).toEqual({
				unrelated: 'keep',
			});
		},
	);

	it('only injects LSP workflow guidance when relevant tools are available', () => {
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: undefined,
			}),
		).toBe(true);
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: { selectedTools: ['lsp_hover'] },
			}),
		).toBe(true);

		for (const tool of ['codemode', 'tool_search']) {
			expect(
				should_inject_lsp_prompt({
					systemPromptOptions: { selectedTools: [tool] },
				}),
			).toBe(true);
		}

		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: {
					selectedTools: ['bash', 'read'],
				},
			}),
		).toBe(false);
	});
});
