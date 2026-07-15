import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_export_tool } from './export.js';

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

function temp_dir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function register_tool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	register_context_export_tool({
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

describe('context_export tool', () => {
	it('writes selected chunk content to a file without returning it inline', async () => {
		const db_dir = temp_dir('pi-context-export-db-');
		process.env.MY_PI_CONTEXT_DB = join(db_dir, 'context.db');
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		const stored = get_context_store().store({
			text: `export-token\n${'x '.repeat(400)}`,
			tool_name: 'bash',
			force: true,
		});
		const output = join(
			temp_dir('pi-context-export-out-'),
			'export.txt',
		);
		const tool = register_tool();

		expect(tool.description).toContain('broad/full JSON/log/script');
		expect(tool.description).toContain('full source offline');
		expect(tool.promptSnippet).toContain('offline rg/jq/Python');
		expect(tool.parameters.properties.chunk_id.description).toContain(
			'full source for offline processing',
		);

		const result = await tool.execute('call', {
			source_id: stored!.source_id,
			file_path: output,
			global: true,
		});

		expect(result.content[0].text).toContain('Exported 1 chunk(s)');
		expect(result.content[0].text).not.toContain('export-token');
		expect(readFileSync(output, 'utf8')).toContain('export-token');
		expect(result.details).toMatchObject({
			count: 1,
			exported: true,
			file_path: output,
			verified: true,
		});
	});

	it('returns the standard missing-source summary when nothing is exported', async () => {
		const db_dir = temp_dir('pi-context-export-missing-');
		process.env.MY_PI_CONTEXT_DB = join(db_dir, 'context.db');
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		const tool = register_tool();

		const result = await tool.execute('call', {
			source_id: 'ctx_missing',
			global: true,
		});

		expect(result.content[0].text).toContain(
			'Source ctx_missing was not found',
		);
		expect(result.details).toMatchObject({
			count: 0,
			exported: false,
		});
	});
});
