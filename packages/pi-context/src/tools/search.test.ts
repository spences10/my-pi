import { capture_tool, tool_text } from '../../test/tool-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_search_tool } from './search.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-search-'));
	dirs.push(dir);

	return join(dir, 'context.db');
}

function register_tool() {
	return capture_tool(register_context_search_tool);
}

afterEach(() => {
	set_context_sidecar_enabled(false);

	if (original_context_db === undefined)
		delete process.env.MY_PI_CONTEXT_DB;
	else process.env.MY_PI_CONTEXT_DB = original_context_db;

	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('context_search tool', () => {
	it('registers and searches scoped context output', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		get_context_store().store({
			text: `alpha-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo-a',
		});
		get_context_store().store({
			text: `beta-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo-b',
		});
		const tool = register_tool();

		const result = await tool.execute('call', {
			query: 'token',
			global: true,
		});

		expect(tool.name).toBe('context_search');
		expect(tool.description).toContain('snippet-first');
		expect(tool.description).toContain('full_content:true');
		expect(tool.description).toContain('not broad retrieval');
		expect(tool.promptSnippet).toContain('export broad results');
		expect(tool.parameters).toMatchObject({
			properties: {
				full_content: {
					description: expect.stringContaining(
						'Last resort for small matches',
					),
				},
			},
		});
		expect(tool_text(result)).toContain('alpha-token');
		expect(tool_text(result)).toContain('beta-token');
		expect(result.details).toMatchObject({ count: 2 });
	});
});
