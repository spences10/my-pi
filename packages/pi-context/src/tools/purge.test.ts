import { capture_tool, tool_text } from '../../test/tool-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_purge_tool } from './purge.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-purge-'));
	dirs.push(dir);

	return join(dir, 'context.db');
}

function register_tool() {
	return capture_tool(register_context_purge_tool);
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

describe('context_purge tool', () => {
	it('purges an explicit source id without applying age filters', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});

		const tool = register_tool();

		const stored = get_context_store().store({
			text: `purge-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: tool.context.cwd,
			session_id: tool.context.sessionManager.getSessionId(),
		});

		const result = await tool.execute('call', {
			source_id: stored!.source_id,
		});

		expect(tool_text(result)).toContain(
			'Deleted 1 context source(s).',
		);
		expect(result.details).toMatchObject({
			deleted: 1,
			source_id: stored!.source_id,
		});
		expect(
			get_context_store().get(stored!.source_id, undefined, {
				global: true,
			}),
		).toEqual([]);
	});
});
