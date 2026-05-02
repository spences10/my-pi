import { describe, expect, it } from 'vitest';
import {
	create_mock_client,
	create_test_pi,
} from '../test/support.js';
import { create_lsp_extension } from './index.js';

describe('lsp extension wiring', () => {
	it('registers the LSP tools and /lsp command', async () => {
		const client = create_mock_client();
		const { pi, tools, commands, events } = create_test_pi();

		await create_lsp_extension({
			create_client: () => client,
			read_file: async () => 'export const value = 1;\n',
			cwd: () => '/repo',
		})(pi);

		expect(Array.from(tools.keys()).sort()).toEqual([
			'lsp_definition',
			'lsp_diagnostics',
			'lsp_diagnostics_many',
			'lsp_document_symbols',
			'lsp_find_symbol',
			'lsp_hover',
			'lsp_references',
		]);
		expect(commands.has('lsp')).toBe(true);
		expect(events.has('before_agent_start')).toBe(true);
		expect(events.has('session_shutdown')).toBe(true);
	});
});
