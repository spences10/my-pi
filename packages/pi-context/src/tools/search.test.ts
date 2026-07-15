import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_search_tool } from './search.js';

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
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-search-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function register_tool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	register_context_search_tool({
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
		expect(
			tool.parameters.properties.full_content.description,
		).toContain('Last resort for small matches');
		expect(result.content[0].text).toContain('alpha-token');
		expect(result.content[0].text).toContain('beta-token');
		expect(result.details.count).toBe(2);
	});
});
