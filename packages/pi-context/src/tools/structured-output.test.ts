import {
	make_api,
	make_tool_context,
} from '../../../../tools/test-sdk.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Static } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_tools } from './index.js';
import {
	context_search_output_schema,
	context_get_output_schema,
	context_list_output_schema,
	context_stats_output_schema,
	context_purge_output_schema,
	context_export_output_schema,
} from './output-schemas.js';

const output_schemas = {
	context_search: context_search_output_schema,
	context_get: context_get_output_schema,
	context_list: context_list_output_schema,
	context_stats: context_stats_output_schema,
	context_purge: context_purge_output_schema,
	context_export: context_export_output_schema,
};

// Exercise real tool implementations, including empty/missing results, against their declarations.
describe('context structured outputs', () => {
	it('matches every output schema and keeps maintenance tools discoverable', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'pi-context-structured-'));
		const previous = process.env.MY_PI_CONTEXT_DB;
		process.env.MY_PI_CONTEXT_DB = join(dir, 'context.db');
		const pi = make_api();
		const register_tool = vi.spyOn(pi, 'registerTool');
		register_context_tools(pi);
		const tools = register_tool.mock.calls.map(([tool]) => tool);

		const ctx = make_tool_context({
			cwd: dir,
			sessionManager: { getSessionId: () => 'test' },
		});

		const store = get_context_store({
			project_path: dir,
			session_id: 'test',
		});

		const stored = store.store({
			text: 'schema-marker\n'.repeat(400),
			tool_name: 'bash',
		})!;

		const execute = async <
			Name extends keyof typeof output_schemas,
			Args,
		>(
			name: Name,
			args: Args,
		): Promise<Static<(typeof output_schemas)[Name]>> => {
			const tool = tools.find((item) => item.name === name)!;

			Value.Assert(tool.parameters, args);

			const result = await tool.execute(
				'test',
				args,
				undefined,
				undefined,
				ctx,
			);

			expect(tool.outputSchema).toBe(output_schemas[name]);
			Value.Assert(output_schemas[name], result.structuredContent);

			return result.structuredContent;
		};

		try {
			expect(
				tools.find((tool) => tool.name === 'context_export')
					?.annotations?.destructiveHint,
			).toBe(true);

			for (const tool of tools) {
				expect(tool.namespace?.name).toBe('context');
				expect(tool.outputSchema).toBeDefined();
				expect(tool.exposure).toBe(
					['context_stats', 'context_purge'].includes(tool.name)
						? 'deferred'
						: undefined,
				);
			}

			expect(
				(await execute('context_search', { query: 'schema-marker' }))
					.results,
			).not.toEqual([]);
			expect(
				(await execute('context_search', { query: 'absent' }))
					.results,
			).toEqual([]);
			expect(
				(
					await execute('context_get', {
						source_id: stored.source_id,
						chunk_id: '1',
					})
				).chunks,
			).not.toEqual([]);
			expect(
				(await execute('context_get', { source_id: 'missing' }))
					.message,
			).toContain('not found');
			expect(
				(await execute('context_list', {})).sources,
			).toHaveLength(1);
			expect((await execute('context_stats', {})).sources).toBe(1);
			expect(
				(
					await execute('context_export', {
						source_id: stored.source_id,
						file_path: join(dir, 'output.txt'),
					})
				).file_path,
			).toBe(join(dir, 'output.txt'));
			expect(
				(await execute('context_export', { source_id: 'missing' }))
					.exported,
			).toBe(false);
			expect(
				(
					await execute('context_purge', {
						source_id: stored.source_id,
					})
				).deleted,
			).toBe(1);
		} finally {
			set_context_sidecar_enabled(false);
			store.close();

			if (previous === undefined) delete process.env.MY_PI_CONTEXT_DB;
			else process.env.MY_PI_CONTEXT_DB = previous;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
