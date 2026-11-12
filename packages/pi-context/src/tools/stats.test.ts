import { capture_tool, tool_text } from '../../test/tool-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_stats_tool } from './stats.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-stats-'));
	dirs.push(dir);

	return join(dir, 'context.db');
}

function register_tool() {
	return capture_tool(register_context_stats_tool);
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

describe('context_stats tool', () => {
	it('reports scoped and global store counts', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		const tool = register_tool();
		get_context_store().store({
			text: `stats-a\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo-a',
			session_id: tool.context.sessionManager.getSessionId(),
		});
		get_context_store().store({
			text: `stats-b\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo-b',
		});

		const scoped = await tool.execute(
			'call',
			{},
			undefined,
			undefined,
			{ cwd: '/repo-a' },
		);

		expect(tool_text(scoped)).toContain('context-sidecar stats');
		expect(scoped.details).toMatchObject({
			sources: 1,
			global_sources: 2,
		});

		const global = await tool.execute(
			'call',
			{ global: true },
			undefined,
			undefined,
			{ cwd: '/repo-a' },
		);

		expect(tool_text(global)).toContain('Scope: global');
		expect(global.details).toMatchObject({
			sources: 2,
			global_sources: 2,
		});
	});
});
