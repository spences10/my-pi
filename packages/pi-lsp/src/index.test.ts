import { describe, expect, it } from 'vitest';
import {
	create_mock_client,
	create_test_lsp_extension,
} from '../test/support.js';

describe('lsp extension wiring', () => {
	it('registers the LSP tools and /lsp command', async () => {
		const client = create_mock_client();
		const { tools, commands, events } =
			await create_test_lsp_extension({
				create_client: () => client,
				read_file: async () => 'export const value = 1;\n',
				cwd: () => '/repo',
			});

		expect(Array.from(tools.keys()).sort()).toEqual([
			'lsp_definition',
			'lsp_diagnostics',
			'lsp_diagnostics_many',
			'lsp_document_symbols',
			'lsp_find_symbol',
			'lsp_hover',
			'lsp_references',
		]);
		const constrained_tools = Array.from(tools.values()).filter(
			(tool) => tool.constrainedSampling !== undefined,
		);
		expect(constrained_tools.map((tool) => tool.name)).toEqual([
			'lsp_hover',
			'lsp_definition',
			'lsp_document_symbols',
		]);
		expect(
			constrained_tools.map((tool) => tool.constrainedSampling),
		).toEqual(
			Array.from({ length: constrained_tools.length }, () => ({
				type: 'json_schema',
				strict: 'prefer',
			})),
		);
		expect(
			constrained_tools.map(
				(tool) => tool.parameters.additionalProperties,
			),
		).toEqual(
			Array.from({ length: constrained_tools.length }, () => false),
		);
		expect(commands.has('lsp')).toBe(true);
		expect(events.has('before_agent_start')).toBe(true);
		expect(events.has('session_shutdown')).toBe(true);
	});
});
