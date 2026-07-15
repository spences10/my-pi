import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_get_tool } from './get.js';

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
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-get-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function register_tool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	register_context_get_tool({
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
		expect(tool.parameters.properties.chunk_id.description).toContain(
			'exceptional full-source chat retrieval',
		);

		const found = await tool.execute('call', {
			source_id: stored!.source_id,
			global: true,
		});
		expect(found.content[0].text).toContain('get-token');
		expect(found.details).toMatchObject({ count: 1 });

		const missing = await tool.execute('call', {
			source_id: stored!.source_id,
			chunk_id: 'missing',
			global: true,
		});
		expect(missing.content[0].text).toContain('No chunk found');
		expect(missing.details).toMatchObject({ count: 0 });
	});
});
