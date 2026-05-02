import { describe, expect, it } from 'vitest';
import {
	create_mock_client,
	create_test_pi,
} from '../test/support.js';
import {
	create_lsp_extension,
	should_inject_lsp_prompt,
} from './index.js';

describe('lsp prompt guidance', () => {
	it('injects LSP workflow guidance when LSP tools are active', async () => {
		const { pi, events } = create_test_pi();

		await create_lsp_extension({
			create_client: () => create_mock_client(),
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		const result = await events.get('before_agent_start')({
			systemPrompt: 'base prompt',
			systemPromptOptions: { selectedTools: ['lsp_diagnostics'] },
		});

		expect(result.systemPrompt).toContain('base prompt');
		expect(result.systemPrompt).toContain(
			'Language server support via LSP tools',
		);
		expect(result.systemPrompt).toContain(
			'check changed files with LSP diagnostics before reporting completion or committing',
		);
		expect(result.systemPrompt).toContain(
			'Prefer LSP diagnostics over guessing from build output',
		);
	});

	it('only injects LSP workflow guidance when relevant tools are available', () => {
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: undefined,
			} as any),
		).toBe(true);
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: { selectedTools: ['lsp_hover'] } as any,
			}),
		).toBe(true);
		expect(
			should_inject_lsp_prompt({
				systemPromptOptions: {
					selectedTools: ['bash', 'read'],
				} as any,
			}),
		).toBe(false);
	});
});
