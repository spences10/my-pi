import { capture_tool, tool_text } from '../../test/tool-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_get_tool } from './get.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-get-'));
	dirs.push(dir);

	return join(dir, 'context.db');
}

function register_tool() {
	return capture_tool(register_context_get_tool);
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

describe('context_get tool', () => {
	it('retrieves chunks and returns helpful empty summaries', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});

		const stored = get_context_store().store({
			text: `get-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
		});

		const tool = register_tool();

		expect(tool.description).toContain('source_id plus chunk_id');
		expect(tool.description).toContain('omitting chunk_id');
		expect(tool.description).toContain('full source into chat');
		expect(tool.promptSnippet).toContain(
			'avoid full-source chat retrieval',
		);
		expect(tool.parameters).toMatchObject({
			properties: {
				chunk_id: {
					description: expect.stringContaining(
						'exceptional full-source chat retrieval',
					),
				},
			},
		});

		const found = await tool.execute('call', {
			source_id: stored!.source_id,
			global: true,
		});

		expect(tool_text(found)).toContain('get-token');
		expect(found.details).toMatchObject({ count: 1 });

		const missing = await tool.execute('call', {
			source_id: stored!.source_id,
			chunk_id: 'missing',
			global: true,
		});

		expect(tool_text(missing)).toContain('No chunk found');
		expect(missing.details).toMatchObject({ count: 0 });
	});
});
