import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_list_tool } from './list.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

type RegisteredTool = {
	name: string;
	description: string;
	promptSnippet: string;
	parameters: { properties: Record<string, { description: string }> };
	execute: (...args: unknown[]) => Promise<{
		content: Array<{ text: string }>;
		details: { count?: number; [key: string]: unknown };
	}>;
};

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-list-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function register_tool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	register_context_list_tool({
		registerTool(value: RegisteredTool) {
			tool = value;
		},
	} as unknown as ExtensionAPI);
	return tool!;
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
		expect(scoped.content[0].text).toContain('Project: /repo-a');
		expect(scoped.content[0].text).not.toContain('Project: /repo-b');
		expect(scoped.details.count).toBe(1);

		const explicit = await tool.execute('call', {
			project_path: '/repo-b',
			limit: 10,
		});
		expect(explicit.content[0].text).toContain('Tool: read');
		expect(explicit.details.count).toBe(1);
	});
});
