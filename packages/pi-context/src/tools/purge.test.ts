import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_purge_tool } from './purge.js';

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
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-purge-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function register_tool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	register_context_purge_tool({
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

describe('context_purge tool', () => {
	it('purges an explicit source id without applying age filters', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		const stored = get_context_store().store({
			text: `purge-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
		});
		const tool = register_tool();

		const result = await tool.execute('call', {
			source_id: stored!.source_id,
		});

		expect(result.content[0].text).toContain(
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
