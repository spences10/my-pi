import { capture_tool, tool_text } from '../../test/tool-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_list_tool } from './list.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-list-'));
	dirs.push(dir);

	return join(dir, 'context.db');
}

function register_tool() {
	return capture_tool(register_context_list_tool);
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

describe('context_list tool', () => {
	it('defaults to context scope and honors explicit scope filters', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		get_context_store().store({
			text: `repo-a-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo-a',
			session_id: 's-a',
		});
		get_context_store().store({
			text: `repo-b-token\n${'x '.repeat(400)}`,
			tool_name: 'read',
			force: true,
			project_path: '/repo-b',
			session_id: 's-b',
		});
		const tool = register_tool();

		const scoped = await tool.execute(
			'call',
			{ limit: 10 },
			undefined,
			undefined,
			{
				cwd: '/repo-a',
				sessionManager: { getSessionId: () => 's-a' },
			},
		);

		expect(tool_text(scoped)).toContain('Project: /repo-a');
		expect(tool_text(scoped)).not.toContain('Project: /repo-b');
		expect(scoped.details).toMatchObject({ count: 1 });

		const explicit = await tool.execute('call', {
			project_path: '/repo-b',
			limit: 10,
		});

		expect(tool_text(explicit)).toContain('Tool: read');
		expect(explicit.details).toMatchObject({ count: 1 });
	});
});
